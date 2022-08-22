
// exposes a minimal interface of only what we use from Google, providing mock
// responses to allow overall flow to be tested without actually hitting Google.
// still takes a google package object (from lib/formats) for local functions
// like generateAuthUrl.
// TODO: no tests for the drive stuff yet; feels like busywork for no gain.
module.exports = (google) => ({
  auth: {
    generateAuthUrl: (options) => google.auth.generateAuthUrl(options),
    getToken: (code) => ((code === 'happy google')
      ? Promise.resolve({ tokens: { code } })
      // eslint-disable-next-line prefer-promise-reject-errors
      : Promise.reject({ response: { data: { code } } })) // this is the format their errors take.
  }
});

