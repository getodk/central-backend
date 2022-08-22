// suggested usage
// .then(some(annoying(nonsense, here)))
//     v  v  v  v  v   v  v  v  v  v
// .then(some(tap('annoying:', annoying(nonsense, here))))
//     v  v  v  v  v   v  v  v  v  v  v  v  v  v  v  v  v   v  v  v  v  v
// .then(some(tap('annoying:', annoying(tap('nonsense:', nonsense), here))))

/* eslint-disable no-console */
global.tap = (...xs) => { console.log(...xs); return xs[xs.length - 1]; };
global.tap.trace = (...xs) => { console.trace(...xs); return xs[xs.length - 1]; };
/* eslint-enable no-console */

