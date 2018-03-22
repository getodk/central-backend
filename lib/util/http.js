// Helper functions that relate to the HTTP/service layer of the application.

const { isBlank } = require('./util');

const isTrue = (x) => (!isBlank(x) && (x.toLowerCase() === 'true'));

// Standard simple serializer for object output.
const serialize = (obj) => {
  if (Buffer.isBuffer(obj))
    return obj;
  else if ((obj === null) || (obj === undefined))
    return obj;
  else if (typeof obj.forApi === 'function')
    return obj.forApi();
  else if (Array.isArray(obj))
    return obj.map(serialize);
  else if (typeof obj === 'string')
    return obj;

  return JSON.stringify(obj);
};

const success = () => ({ success: true });

module.exports = { serialize, success, isTrue };

