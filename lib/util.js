
////////////////////////////////////////////////////////////////////////////////
// ???

const createError = (message, code) => {
  const result = new Error(message);
  result.code = code;
  return result;
};


////////////////////////////////////////////////////////////////////////////////
// OUTPUT HANDLERS

// 200 OK
const _ok = (response, result, mime = 'application/json') => response.status(200).type(mime).send(JSON.stringify(result));
const ok = (response, result, mime) => {
  // if only a response is given, curry instead.
  if (result === undefined)
    return (curriedResult, curriedMime) => _ok(response, curriedResult, curriedMime);

  return _ok(response, result, mime);
};

const badRequest = (response, error) => response.status(400).type('application/json')
  .send({ http: 400, code: error.code, message: error.message });

// TODO: this is also maybe a common idiom? return generic error if Error details are blank.
const notFound = (response, error) => {
  const body = (error == null) ? { http: 404, message: 'Not found!' } : { http: 404, code: error.code, message: error.message };
  response.status(404).type('application/json').send(body);
};

// TODO: this has a different func signature; should probably make a
// curry wrapper that we can apply across the board??
const internalError = (response) => (error) => {
  process.stderr.write(error);
  response.status(500).type('application/json').send({ code: error.code, message: error.message });
};


// database failure handler; attempts to interpret DB exceptions.
// TODO: figure out how better to deal with this.
const dbErrorHandler = (response) => (error) => {
  if (error.code === '23505')
    badRequest(response, new Error('A record with that unique identifier already exists!'));
  else
    internalError(response)(error);
};


////////////////////////////////////////////////////////////////////////////////
// OBJECT OPERATIONS

// returns a /new/ object with a shallow-copy of all keys from given objs overlaid.
// at some point we may replace this with something more robust/deepmerge.
const merge = (...objs) => Object.assign({}, ...objs);



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



module.exports = { error: createError, ok, badRequest, notFound, internalError, dbErrorHandler, merge };

