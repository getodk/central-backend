// An Error associated with an HTTP status code and a Jubilant-specific error
// code
class JubilantError extends Error {
  constructor(httpStatusCode, jubilantCode, message) {
    super(message);
    Error.captureStackTrace(this, JubilantError);
    this.httpStatusCode = httpStatusCode;
    this.jubilantCode = jubilantCode;
  }

  toJSON() {
    return {
      http: this.httpStatusCode,
      code: this.jubilantCode,
      message: this.message
    };
  }
}

// Next, we add a series of static factory methods to JubilantError. Each
// receives an error message and returns a JubilantError object. Each method is
// associated with a single HTTP status code and Jubilant error code and returns
// a JubilantError object with those properties.

// methodDataByStatus contains data about these static factory methods,
// organized by HTTP status code. Each method has a name and is associated with
// an HTTP status code and Jubilant error code.
const methodDataByStatus = {
  400: {
    parsing: 1,
    duplicateRecord: 2
  },
  404: {
    invalidRoute: 3,
    recordNotFound: 4
  },
  500: {
    unknownError: 5,
    unknownDbError: 6
  }
};

for (const [httpStatusCode, methodData] of Object.entries(methodDataByStatus)) {
  for (const [name, jubilantCode] of Object.entries(methodData)) {
    JubilantError[name] = function(message) {
      return new this(Number(httpStatusCode), jubilantCode, message);
    };
  }
}

module.exports = JubilantError;
