class BaseController {
  constructor(request, response) {
    this.request = request;
    this.response = response;
    // Convert ok() and error() to bound functions so that they play well in
    // promise chains, which otherwise would not bind `this` to the controller
    // when invoking ok() and error() as callbacks.
    this.ok = this.ok.bind(this);
    this.error = this.error.bind(this);
  }

  // ok() converts the specified result to JSON, then sends it as the body of a
  // 200 response. ok() becomes a bound function in the constructor.
  ok(result) {
    this.response.status(200).type('application/json');
    this.response.send(JSON.stringify(result));
  }

  // error() converts the specified JubilantError to JSON and sends it as the
  // response body. The HTTP status code is set according to the JubilantError.
  // error() becomes a bound function in the constructor.
  error(jubilantError) {
    if (jubilantError.httpStatusCode === 500)
      console.error(jubilantError);
    this.response.status(jubilantError.httpStatusCode).type('application/json');
    this.response.send(JSON.stringify(jubilantError));
  }
}

module.exports = BaseController;
