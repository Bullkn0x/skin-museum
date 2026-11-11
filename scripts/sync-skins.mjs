#!/usr/bin/env node
/**
 * Skin Museum sync
 *
 * Reads museum.config.json, pulls item details from the public Steam inventory
 * and writes data/skins.json plus local copies of every image the museum needs.
 *
 *   node scripts/sync-skins.mjs               build data/skins.json from museum.config.json
 *   node scripts/sync-skins.mjs --list        print every item in the inventory (asset id + name)
 *   node scripts/sync-skins.mjs --list karambit   ...filtered by a search term
 *   node scripts/sync-skins.mjs --showcase    replace the item list with the profile's Item Showcase
 *
 * Per-item keys in museum.config.json:
 *   asset     Steam asset id (the number at the end of an inventory link)
 *   class     "classid/instanceid" - fallback for items the public inventory hides
 *             (trade-protected items). Written automatically by --showcase.
 *   featured  true = gets a hero spot (first featured item takes the end wall)
 *   display   "wall" | "pedestal" | "hero" - override the automatic placement
 *   note      your own curator's note, shown in the detail panel
 *   image     path to your own render/screenshot to use instead of the Steam icon
 *   float, pattern, nameTag   manual overrides when Steam does not expose them
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'museum.config.json');
const OUT_PATH = path.join(ROOT, 'data', 'skins.json');
const APP = 730;
const IMG_BASE = 'https://community.fastly.steamstatic.com/economy/image/';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh) skin-museum-sync', 'Accept-Language': 'en-US,en;q=0.9' };

const RARITY_COLORS = {
  'Consumer Grade': '#b0c3d9', 'Base Grade': '#b0c3d9',
  'Industrial Grade': '#5e98d9',
  'Mil-Spec Grade': '#4b69ff', 'High Grade': '#4b69ff',
  'Restricted': '#8847ff', 'Remarkable': '#8847ff',
  'Classified': '#d32ce6', 'Exotic': '#d32ce6',
  'Covert': '#eb4b4b', 'Extraordinary': '#eb4b4b',
  'Contraband': '#e4ae39',
};
const RARITIES = Object.keys(RARITY_COLORS).sort((a, b) => b.length - a.length);
const PEDESTAL_CATEGORIES = /knife|gloves|collectible|charm|sticker|agent|patch|music|container|graffiti/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { tries = 4, as = 'text' } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return as === 'json' ? res.json() : as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text();
    if (res.status === 429 || res.status >= 500) {
      const wait = 4000 * (i + 1);
      console.warn(`  ${res.status} from Steam, retrying in ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  throw new Error(`Gave up on ${url} (Steam is rate limiting - try again in a few minutes)`);
}

const stripTags = (html = '') =>
  html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').trim();

async function resolveSteamId(config) {
  if (config.steamId) return config.steamId;
  const html = await get(config.profile);
  const m = html.match(/"steamid":"(\d{17})"/);
  if (!m) throw new Error('Could not find a steamId on the profile page - set "steamId" in museum.config.json');
  return m[1];
}

async function fetchInventory(steamId) {
  const assets = [];
  const descriptions = new Map();
  const props = new Map();
  let start = null;
  for (let page = 0; page < 10; page++) {
    const url = `https://steamcommunity.com/inventory/${steamId}/${APP}/2?l=english&count=1000${start ? `&start_assetid=${start}` : ''}`;
    const j = await get(url, { as: 'json' });
    for (const a of j.assets || []) assets.push(a);
    for (const d of j.descriptions || []) descriptions.set(`${d.classid}/${d.instanceid}`, d);
    for (const p of j.asset_properties || []) props.set(p.assetid, p);
    if (j.more_items && j.last_assetid) start = j.last_assetid; else break;
  }
  return { assets, descriptions, props };
}

/** Fallback for items the public inventory does not list (e.g. trade-protected). */
async function fetchClassInfo(classRef) {
  const js = await get(`https://steamcommunity.com/economy/itemclasshover/${APP}/${classRef}?content_only=1&l=english`);
  const m = js.match(/BuildHover\(\s*'[^']*',\s*(\{[\s\S]*\})\s*\);/);
  if (!m) throw new Error(`No class info for ${classRef}`);
  const d = JSON.parse(m[1]);
  if (d.descriptions && !Array.isArray(d.descriptions)) d.descriptions = Object.values(d.descriptions);
  if (d.tags && !Array.isArray(d.tags)) d.tags = Object.values(d.tags);
  if (d.actions && !Array.isArray(d.actions)) d.actions = Object.values(d.actions);
  return d;
}

function parseAccessoryImages(html = '') {
  const out = [];
  const re = /<img[^>]+src="([^"]+)"[^>]*title="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ image: m[1], title: stripTags(m[2]) });
  return out;
}

function parseType(type = '') {
  let rest = type.replace(/★\s*/g, '').replace(/StatTrak™\s*/g, '').replace(/^(Souvenir|Genuine)\s+/, '').trim();
  const rarity = RARITIES.find((r) => rest.startsWith(r)) || null;
  if (rarity) rest = rest.slice(rarity.length).trim();
  return { rarity, category: rest || null };
}

function buildSkin(entry, desc, prop, steamId) {
  const tags = Object.fromEntries((desc.tags || []).map((t) => [t.category, t.localized_tag_name || t.name]));
  const lines = Object.fromEntries((desc.descriptions || []).filter((d) => d && d.name).map((d) => [d.name, d.value || '']));
  const parsed = parseType(desc.type);
  const pv = (id) => prop?.asset_properties?.find((p) => p.propertyid === id);

  const fullName = desc.name || desc.market_hash_name;
  const cleanName = fullName.replace(/★\s*/g, '').replace(/StatTrak™\s*/g, '').replace(/^Souvenir\s+/, '').trim();
  const [weapon, finish] = cleanName.includes(' | ') ? cleanName.split(' | ') : [cleanName, null];
  const rarity = tags.Rarity || parsed.rarity;
  const category = tags.Type || parsed.category;
  const exterior = tags.Exterior && tags.Exterior !== 'Not Painted'
    ? tags.Exterior
    : (stripTags(lines.exterior_wear).replace(/^Exterior:\s*/, '') || null);

  const descHtml = lines.description || '';
  const flavorMatch = descHtml.match(/<i>([\s\S]*?)<\/i>/);
  const description = stripTags(descHtml.replace(/<i>[\s\S]*?<\/i>/, '')) || null;
  const killMatch = stripTags(lines.stattrak_score).match(/([\d,]+)\s*$/);

  const accessories = prop?.asset_accessories || [];
  const stickerWear = accessories
    .filter((a) => a.parent_relationship_properties)
    .map((a) => a.parent_relationship_properties.find((p) => p.propertyid === 4)?.float_value);
  const stickers = parseAccessoryImages(lines.sticker_info).map((s, i) => ({
    name: s.title.replace(/^Sticker:\s*/, ''),
    image: s.image,
    wear: stickerWear[i] != null ? Number(Number(stickerWear[i]).toFixed(4)) : null,
  }));
  const charmRaw = parseAccessoryImages(lines.keychain_info)[0];
  let charm = null;
  if (charmRaw) {
    const [kind, ...rest] = charmRaw.title.split(': ');
    const charmAcc = accessories.find((a) => a.standalone_properties);
    charm = {
      kind, name: rest.join(': '), image: charmRaw.image,
      pattern: charmAcc?.standalone_properties.find((p) => p.propertyid === 3)?.int_value ?? null,
    };
  }

  const cert = pv(6)?.string_value;
  const inspectTemplate = (desc.actions || [])[0]?.link;
  let inspect = null;
  if (inspectTemplate && inspectTemplate.includes('%propid:6%')) {
    inspect = cert ? inspectTemplate.replace('%propid:6%', cert) : null;
  } else if (inspectTemplate) {
    inspect = inspectTemplate.replace('%owner_steamid%', steamId).replace('%assetid%', entry.asset);
  }

  const floatRaw = entry.float ?? pv(2)?.float_value;
  const isStar = /★/.test(fullName) || /★/.test(desc.type || '');
  const featured = !!entry.featured;
  const display = entry.display || (featured ? 'hero' : PEDESTAL_CATEGORIES.test(category || '') ? 'pedestal' : 'wall');

  return {
    id: entry.asset,
    name: fullName,
    weapon, finish,
    marketHashName: desc.market_hash_name,
    exterior, rarity, category,
    rarityColor: isStar ? '#e4ae39' : RARITY_COLORS[rarity] || '#c9b27c',
    star: isStar,
    statTrak: /StatTrak/.test(fullName) ? (killMatch ? Number(killMatch[1].replace(/,/g, '')) : 0) : null,
    collection: tags.ItemSet || stripTags(lines.itemset_name) || null,
    description,
    flavor: flavorMatch ? stripTags(flavorMatch[1]) : null,
    nameTag: entry.nameTag ?? pv(5)?.string_value ?? null,
    float: floatRaw != null ? Number(floatRaw) : null,
    pattern: entry.pattern ?? (pv(1)?.int_value != null ? Number(pv(1).int_value) : null),
    stickers, charm,
    image: entry.image || null,
    iconUrl: desc.icon_url_large || desc.icon_url,
    inspect,
    market: desc.marketable === 0 ? null : `https://steamcommunity.com/market/listings/${APP}/${encodeURIComponent(desc.market_hash_name)}`,
    featured, display,
    note: entry.note || null,
  };
}

async function download(url, file) {
  if (existsSync(file)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await get(url, { as: 'buffer' }));
}

async function localiseImages(skins) {
  for (const s of skins) {
    if (!s.image) {
      const rel = `assets/skins/${s.id}.png`;
      await download(IMG_BASE + s.iconUrl, path.join(ROOT, rel));
      s.image = rel;
    }
    delete s.iconUrl;
    for (const acc of [...s.stickers, s.charm].filter(Boolean)) {
      if (!/^https?:/.test(acc.image)) continue;
      const rel = `assets/stickers/${path.basename(new URL(acc.image).pathname)}`;
      await download(acc.image, path.join(ROOT, rel));
      acc.image = rel;
    }
  }
}

async function readShowcase(profileUrl) {
  const html = await get(profileUrl);
  const items = [];
  const seen = new Set();
  const re = /data-economy-item="classinfo\/730\/(\d+)\/(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const near = html.slice(m.index, m.index + 900).match(/#730_\d+_(\d+)/);
    if (!near || seen.has(near[1])) continue;
    seen.add(near[1]);
    items.push({ asset: near[1], class: `${m[1]}/${m[2]}` });
  }
  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const steamId = await resolveSteamId(config);

  if (args[0] === '--showcase') {
    const found = await readShowcase(config.profile);
    if (!found.length) throw new Error('No Item Showcase found on the profile page.');
    const previous = new Map((config.items || []).map((i) => [i.asset, i]));
    config.items = found.map((i) => ({ ...previous.get(i.asset), ...i }));
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log(`museum.config.json now lists the ${found.length} showcase items. Run the sync again without flags.`);
    return;
  }

  console.log('Fetching inventory...');
  const inv = await fetchInventory(steamId);

  if (args[0] === '--list') {
    const term = (args[1] || '').toLowerCase();
    const rows = inv.assets
      .map((a) => ({ a, d: inv.descriptions.get(`${a.classid}/${a.instanceid}`) }))
      .filter(({ d }) => d && (!term || d.market_hash_name.toLowerCase().includes(term)))
      .sort((x, y) => x.d.market_hash_name.localeCompare(y.d.market_hash_name));
    for (const { a, d } of rows) console.log(`${a.assetid.padEnd(13)} ${d.market_hash_name}`);
    console.log(`\n${rows.length} items. Add { "asset": "<id>" } entries to museum.config.json, then run the sync.`);
    return;
  }

  const skins = [];
  for (const entry of config.items) {
    const asset = inv.assets.find((a) => a.assetid === String(entry.asset));
    let desc = asset && inv.descriptions.get(`${asset.classid}/${asset.instanceid}`);
    let source = 'inventory';
    if (!desc && entry.class) {
      desc = await fetchClassInfo(entry.class);
      source = 'class info (not in public inventory - no float/pattern)';
      await sleep(350);
    }
    if (!desc) {
      console.warn(`  ! ${entry.asset}: not found in the public inventory and no "class" fallback - skipped`);
      continue;
    }
    const skin = buildSkin(entry, desc, inv.props.get(String(entry.asset)), steamId);
    skins.push(skin);
    console.log(`  + ${skin.marketHashName}  [${skin.display}]  <- ${source}`);
  }

  console.log('Downloading images...');
  await localiseImages(skins);

  const out = {
    museum: { title: config.title, subtitle: config.subtitle, curator: config.curator, profile: config.profile },
    generated: new Date().toISOString(),
    skins,
  };
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${skins.length} skins to data/skins.json`);
}

main().catch((err) => { console.error('\nSync failed:', err.message); process.exit(1); });
