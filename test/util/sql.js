const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { sql } = require(appRoot + '/lib/external/postgres');

// used by .should.eqlQuery()
//
// simplifies a built porsagres sql`` fragment so that it can be reasonably compared
// with a different fragment of a different construction but the same result. eg,
// sql`x and y` vs sql`x ${sql`and`} y`
//
// it's heavily adapted from types.js in porsagres

const Query = sql``.constructor;
const Builder = sql({}).constructor;
const Identifier = sql('identifier').constructor;

const options = { transform: { undefined: null, column: {} } };
/* eslint-disable indent */
const inferType = (x) => (
  // x instanceof Parameter ? x.type : // this line existed in the original code, but
                                       // we don't have easy access to a Parameter ctor
                                       // or, apparently, a need for this line anyway
  x instanceof Date ? 1184 :
  x instanceof Uint8Array ? 17 :
  (x === true || x === false) ? 16 :
  typeof x === 'bigint' ? 20 :
  Array.isArray(x) ? inferType(x[0]) :
  0
);
/* eslint-enable indent */

const reduceFragment = (q, types = [], parameters = []) => {
  let string = q.strings[0];
  for (let i = 1; i < q.strings.length; i += 1)
    // eslint-disable-next-line no-use-before-define
    string += _value(q.args[i - 1], string, parameters, types) + q.strings[i];
  return { string, parameters, types };
};

const _value = (x, string, parameters, types) => {
  if (x instanceof Builder) return x.build(string, parameters, types, options);
  else if (x instanceof Identifier) return x.value;
  else if (x instanceof Query) return reduceFragment(x, types, parameters).string;
  else {
    parameters.push(x);
    types.push(inferType(x));
    return `$${parameters.length}`;
  }
};

module.exports = { reduceFragment };

