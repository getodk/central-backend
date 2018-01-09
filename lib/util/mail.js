const { parse, render } = require('mustache');
const { merge } = require('ramda');
const nodemailer = require('nodemailer');
const config = require('config');

// set up some basic information needed later: env vars are available to every
// template, and the from address never changes.
const env = { domain: config.get('default.domain') };
const from = config.get('default.serviceEmail');

// set up each message.
const message = (subject, body) => {
  parse(subject); // caches template for future perf.
  parse(body); // ditto.
  return (data) => {
    const localData = merge(data, env);
    return { subject: render(subject, localData), html: render(body, localData) };
  };
};
const messages = {
  // Notifies a user that an account has been provisioned at this address; gives
  // them the link required to set their password.
  // {{token}} is the auth token that grants access to this operation.
  'accountCreated': message('Data collection account created', '<html>Hello!<p>An account has been provisioned for you on an Open Data Kit Effective Spork data collection server.</p><p>If this message is unexpected, simply ignore it. Otherwise, please visit the following link to set your password and claim your account:</p><p>https://{{domain}}/account/claim?token={{token}}</p></html>')
};

// actual mail transport stuffs.
const transport = nodemailer.createTransport({ tls: { rejectUnauthorized: false } });
const mail = (to, message, data) => new Promise((resolve, reject) =>
  transport.sendMail(merge({ to, from }, messages[message](data)), (err, info) => {
    if (err != null) return reject(err);
    return resolve(info);
  }));

module.exports = { messages, mail };

