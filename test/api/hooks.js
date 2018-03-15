// declare our universal beforeEach, etc hooks for all tests.

beforeEach(() => {
  // reset the email inbox so that we can reliably count all the messages sent
  // by a single particular operation.
  global.inbox = [];
});

