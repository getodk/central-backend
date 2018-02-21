const { parse, render } = require('mustache');
const { merge } = require('ramda');
const nodemailer = require('nodemailer');
const config = require('config');


////////////////////////////////////////////////////////////////////////////////
// MESSAGES

// set up some basic information needed later: env vars are available to every
// template.
const env = config.get('default.env');

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
  // * {{token}} is the auth token that grants access to this operation.
  accountCreated: message('Data collection account created', '<html>Hello!<p>An account has been provisioned for you on an Open Data Kit Effective Spork data collection server.</p><p>If this message is unexpected, simply ignore it. Otherwise, please visit the following link to set your password and claim your account:</p><p>{{domain}}/#/account/claim?token={{token}}</p><p>The link is valid for 24 hours. After that, you will have to request a new one using the Reset Password tool.</p></html>'),

  // Notifies a user that a password reset has been initialted for their email;
  // gives them the link required to set their password.
  // * {{token}} is the auth token that grants access to this operation.
  accountReset: message('Data collection account password reset', '<html>Hello!<p>A password reset has been requested for this email address.</p><p>If this message is unexpected, simply ignore it. Otherwise, please visit the following link to set your password and claim your account:</p><p>{{domain}}/#/account/claim?token={{token}}</p><p>The link is valid for 24 hours. After that, you will have to request a new one using the Reset Password tool.</p></html>'),

  // Notifies an email address that a password reset has been initiated, but that
  // no account exists at this address.
  accountResetFailure: message('Data collection account password reset', '<html>Hello!<p>A password reset has been requested for this email address, but no account exists with this address.</p><p>If this message is unexpected, simply ignore it. Otherwise, please double check the email address given for your account, and try again using the Reset Password tool.</p></html>')
};


////////////////////////////////////////////////////////////////////////////////
// TRANSPORT INFRASTRUCTURE

// a little helper to reduce transport boilerplate below:
const simpleTransport = (transport, options, callback) => (to, messageId, data) =>
  new Promise((resolve, reject) =>
    transport.sendMail(merge({ to, from: options.serviceAccount }, messages[messageId](data)), (err, info) =>
      callback(err, info, resolve, reject)));

// actual mail transport stuffs. does some wrapping work to smooth over some
// differences (ie how jsonTransport does not actually put anything anywhere).
const sendmail = (options) => {
  const transport = nodemailer.createTransport(merge({ sendmail: true }, options.transportOpts));
  return simpleTransport(transport, options, (err, info, resolve, reject) => {
    if (err != null) return reject(err);
    return resolve(info);
  });
};
const json = (options) => {
  global.inbox = [];
  const transport = nodemailer.createTransport(merge({ jsonTransport: true }, options.transportOpts));
  return simpleTransport(transport, options, (err, info, resolve, reject) => {
    if (err != null) return reject(err);
    global.inbox.push(JSON.parse(info.message));
    process.stdout.write(`>> Outbound email: ${info.message}\n`);
    return resolve(info);
  });
};
const transports = { sendmail, json };
const mailer = (options) => transports[options.transport](options);

module.exports = { messages, mailer };

