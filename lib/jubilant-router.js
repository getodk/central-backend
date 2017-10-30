const BaseController = require('./controller/forms-controller');
const FormsController = require('./controller/forms-controller');
const JubilantError = require('./jubilant-error');
const SubmissionsController = require('./controller/submissions-controller');


// A JubilantRouter is a wrapper of an Express service object that routes
// requests to controllers.
class JubilantRouter {
  // See route() for how pathPrefix is used.
  constructor(service, pathPrefix = '') {
    this.service = service;
    this.pathPrefix = pathPrefix;
  }

  /*
  route() routes requests with the specified HTTP method and path to a
  controller method. For example:

    this.route('get', '/forms', FormsController, 'list');

  If a path is not specified, it is assumed to be the router's path prefix. If
  it is specified, it is automatically prefixed with the path prefix. This
  behavior enables the path() method.
  */
  route(httpMethod, path, controllerClass, controllerMethodName) {
    if (arguments.length === 3) {
      this.route(httpMethod, '', path, controllerClass);
      return;
    }

    const fullPath = this.pathPrefix + path;
    const callback = (request, response) =>
      new controllerClass(request, response)[controllerMethodName]();
    this.service[httpMethod](fullPath, callback);
  }

  get(...args) {
    this.route('get', ...args);
  }

  post(...args) {
    this.route('post', ...args);
  }

  patch(...args) {
    this.route('patch', ...args);
  }

  delete(...args) {
    this.route('delete', ...args);
  }

  /*
  path() prefixes the specified path prefix with this router's path prefix, then
  creates a new router with the combined prefix. It then invokes the callback
  after binding `this` to the new router. path() can be used to group routes
  with the same path prefix. For example:

    this.path('/forms', function() {
      this.get(FormsController, 'list');
      this.post(FormsController, 'create');
      this.get('/:xmlFormId', FormsController, 'get');
    });
    this.post('/submissions', SubmissionsController, 'create');

  This is equivalent to:

    this.get('/forms', FormsController, 'list');
    this.post('/forms', FormsController, 'create');
    this.get('/forms/:xmlFormId', FormsController, 'get');
    this.post('/submissions', SubmissionsController, 'create');

  Because `this` is bound when the callback invoked, it is important that the
  callback not be an arrow function.
  */
  path(pathPrefix, callback) {
    const fullPrefix = this.pathPrefix + pathPrefix;
    callback.apply(new JubilantRouter(this.service, fullPrefix));
  }

  _handleErrors() {
    // Customize the 404 response.
    this.service.use((request, response) => {
      const error = JubilantError.invalidRoute('Unknown API method.');
      new BaseController(request, response).error(error);
    });

    // Handle errors so that stack traces are not sent to the user.
    this.service.use((error, request, response, next) => {
      console.error(error);
      if (request.headersSent)
        next(error);
      else {
        const jubilantError =
          JubilantError.unknownError('An unknown internal error occurred.');
        new BaseController(request, response).error(jubilantError);
      }
    });
  }

  // routeAll() defines all routes. Add new routes here.
  routeAll() {
    this.path('/forms', function() {
      this.get(FormsController, 'list');
      this.post(FormsController, 'create');
      this.path('/:xmlFormId', function() {
        this.get(FormsController, 'get');

        // Existing submissions
        this.get('/submissions', SubmissionsController, 'list');
        this.get('/submissions/:instanceId', SubmissionsController, 'get');
      });
    });
    // New submissions (not OpenRosa-compliant)
    this.post('/submissions', SubmissionsController, 'create');

    this._handleErrors();
  }
}

module.exports = JubilantRouter;
