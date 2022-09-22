// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { mergeRight } = require('ramda');
const nodemailer = require('nodemailer');
const { messages } = require('../formats/mail');

// a little helper to reduce transport boilerplate below:
const simpleTransport = (transport, options, callback) => (to, messageId, data) =>
  new Promise((resolve, reject) =>
    transport.sendMail(mergeRight({ to, from: options.serviceAccount }, messages[messageId](data, options.env)), (err, info) =>
      callback(err, info, resolve, reject)));

// actual mail transport stuffs. does some wrapping work to smooth over some
// differences (ie how jsonTransport does not actually put anything anywhere).
const sendmail = (options) => {
  const transport = nodemailer.createTransport(mergeRight({ sendmail: true }, options.transportOpts));
  return simpleTransport(transport, options, (err, info, resolve, reject) => {
    if (err != null) return reject(err);
    return resolve(info);
  });
};
// TODO: extremely similar to the above.
const smtp = (options) => {
  const transport = nodemailer.createTransport(options.transportOpts);
  return simpleTransport(transport, options, (err, info, resolve, reject) => {
    if (err != null) return reject(err);
    return resolve(info);
  });
};
const json = (options) => {
  global.inbox = [];
  const transport = nodemailer.createTransport(mergeRight({ jsonTransport: true }, options.transportOpts));
  return simpleTransport(transport, options, (err, info, resolve, reject) => {
    if (err != null) return reject(err);
    global.inbox.push(JSON.parse(info.message));
    process.stdout.write(`>> Outbound email: ${info.message}\n`);
    return resolve(info);
  });
};
const transports = { sendmail, smtp, json };
const mailer = (options) => transports[options.transport](options);

module.exports = { mailer };

