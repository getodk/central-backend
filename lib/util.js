
////////////////////////////////////////////////////////////////////////////////
// ???

const error = (message, code) => {
  result = new Error(message);
  result.code = code;
  return result;
};


////////////////////////////////////////////////////////////////////////////////
// OUTPUT HANDLERS

// standard serializer for object output.
const serialize = (obj) => {
  if (typeof obj.serialize === 'function')
    return obj.serialize();
  else if (Array.isArray(obj) || (typeof obj === 'object'))
    return JSON.stringify(obj);
  else
    return obj.toString();
}

// 200 OK
const ok = (response, result, mime) => {
  // if only a response is given, curry instead.
  if (result === undefined)
    return (result, mime) => _ok(response, result, mime);
  else
    return _ok(response, result, mime);
}
const _ok = (response, result, mime = 'application/json') => response.status(200).type(mime).send(serialize(result));

const badRequest = (response, error) => response.status(400).type('application/json')
  .send({ http: 400, code: error.code, message: error.message });
// TODO: this is also maybe a common idiom? return generic error if Error details are blank.
const notFound = (response, error) => {
  let body = (error == null) ? { http: 404, message: "Not found!" } : { http: 404, code: error.code, message: error.message };
  response.status(404).type('application/json').send(body);
};

// TODO: this has a different func signature; should probably make a
// curry wrapper that we can apply across the board??
const internalError = (response) => (error) => {
  console.log(error);
  response.status(500).type('application/json').send({ code: error.code, message: error.message });
};


// database failure handler; attempts to interpret DB exceptions.
// TODO: figure out how better to deal with this.
const dbErrorHandler = (response) => (error) => {
  if (error.code === '23505')
    badRequest(response, new Error("A record with that unique identifier already exists!"));
  else
    internalError(response)(error);
};


////////////////////////////////////////////////////////////////////////////////
// OBJECT OPERATIONS

// returns a /new/ object with a shallow-copy of all keys from given objs overlaid.
// concatenates arrays.
// at some point we may replace this with something more robust/deepmerge.
const merge = (...objs) => {
  const result = {};
  for (const obj of objs)
    for (const key in obj)
      if (Array.isArray(result[key]) && Array.isArray(obj[key]))
        result[key] = result[key].concat(obj[key]);
      else if (obj[key] != null)
        result[key] = obj[key];
  return result;
};



////////////////////////////////////////////////////////////////////////////////
// STRING OPERATIONS

//const sanitize = (x) => x.replace('.', '_');



////////////////////////////////////////////////////////////////////////////////
// MATH OPERATIONS

/*
const incr = () => {
  let x = 0;
  return () => ++x;
};
*/



module.exports = { error, serialize, ok, badRequest, notFound, internalError, dbErrorHandler, merge };

