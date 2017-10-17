const BaseController = require('./base-controller');
const Form = require('../model/form');


class FormsController extends BaseController {
  // Saves a new form definition.
  create() {
    Form
      .fromXml(this.request.body)
      .then(form => form.save())
      .then(this.ok, this.error);
  }

  // Gets all form definitions.
  list() { Form.all().loadRows().then(this.ok, this.error); }

  // Gets a form definition.
  get() {
    Form
      .forXmlFormId(this.request.params.xmlFormId)
      .loadRowElseError('Cannot find form with the given ID.')
      .then(this.ok, this.error);
  }
}

module.exports = FormsController;
