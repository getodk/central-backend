const { parse, render } = require('mustache');

const template = (body) => {
  parse(body); // caches template for future perf.
  return (data) => render(body, data);
};

// Takes nature and message; returns a standard plain message.
const openRosaMessage = template(`
  <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
    <message nature="{{nature}}">{{message}}</message>
  </OpenRosaResponse>`);

module.exports = { openRosaMessage };

