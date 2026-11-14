// The two night-club looks. Same hall, different materials, colours and light shows.

export const LOOKS = {
  velvet: {
    key: 'velvet', label: 'Velvet', neon: false,
    fog: 0x0a0406, fogDensity: 0.015,
    wall: 0x42172a, wallDark: 0x200b15, ceiling: 0x0b0607, slab: 0x160b10,
    metal: 0xb38a4c, metalRough: 0.42,                       // brass
    dark: 0x0c0809,                                          // black lacquer
    rope: 0xa3122a, carpet: 0x7d1026, seat: 0x8a1230,
    warm: 0xffe2b8,
    led: 0xffc070,                                           // cove and edge strips
    palette: [0xffb347, 0xff3d9a, 0xffe2b8, 0xff6b4a],       // moving lights
    sign: '#ff5c9f', signFont: 'Yellowtail, "Brush Script MT", cursive', signWeight: 400,
    bloom: { strength: 0.4, radius: 0.65, threshold: 0.95 },
    idleBpm: 112,
  },
  neon: {
    key: 'neon', label: 'Neon Grid', neon: true,
    fog: 0x04040f, fogDensity: 0.014,
    wall: 0x16163f, wallDark: 0x0b0b26, ceiling: 0x04040c, slab: 0x0a0a24,
    metal: 0xb4bedf, metalRough: 0.22,                       // chrome
    dark: 0x07071c,
    rope: 0xb01230, carpet: 0x10103a, seat: 0x23267a,
    warm: 0xdfefff,
    led: 0x19e3ff,
    palette: [0x19e3ff, 0xff2bd6, 0x8a5bff, 0x2b6bff],
    sign: '#19e3ff', signFont: 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif', signWeight: 700,
    bloom: { strength: 0.5, radius: 0.7, threshold: 0.92 },
    idleBpm: 124,
  },
};

/** Hall dimensions, in metres. The entrance is at z = 0 and the DJ booth at the far end. */
export const DIM = {
  HW: 7,            // half width
  H: 7.8,           // ceiling
  L: 30,            // length
  YB: 3.3,          // height of the upstairs floor
  SLAB: 0.28,
  BX: 3.8,          // balcony edge (|x|)
  ZG: -26.4,        // front edge of the end gallery
  ZB: -8.4,         // near end of the side balconies
  SX0: 2.2, SX1: 3.8,   // stairs, |x| range
  ZS: -21.4,        // foot of the stairs
  DANCE: { x0: -3.2, x1: 3.2, z0: -20.4, z1: -6.0, tile: 0.8 },
};
