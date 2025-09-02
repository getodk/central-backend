const testData = require('./xml');
const { isPalatableXML } = require('../palatable-xml');


describe('Validity of form testdata XML', () => {
  it('should be well-formed XML', () => {
    Object.entries(testData.forms).forEach(([key, val]) => {
      try {
        isPalatableXML(val);
      } catch (err) {
        const myErr = new Error(`Invalid XML encountered at forms.${key}`);
        myErr.cause = err;
        throw myErr;
      }
    });
  });
});
