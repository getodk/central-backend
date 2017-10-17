
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

// sendError() converts the specified JubilantError to JSON and sends it as the
// response body. The HTTP status code is set according to the JubilantError.
const sendError = (response, jubilantError) => {
  if (jubilantError === undefined)
    return (curriedError) => sendError(response, curriedError);

  if (jubilantError.httpStatusCode === 500)
    console.error(jubilantError);
  response.status(jubilantError.httpStatusCode).type('application/json');
  response.send(JSON.stringify(jubilantError));
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



module.exports = { ok, sendError, merge };

