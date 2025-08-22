const libxmljs = require('libxmljs');
const testXML = require('./xml');

function* getStrings(thing) {
  // traverse object `thing`; yield pairs of ([pathcomponent, ...], someString)
  if (typeof thing === 'string') {
    yield [[], thing];
  } else {
    for (const [k, v] of Object.entries(thing)) {
      if (typeof v === 'string') {
        yield [[k], v];
      } else {
        for (const [stack, str] of getStrings(v)) yield [[k].concat(stack), str];
      }
    }
  }
}

function isPalatableXML(allegedXML) {
  const xmlDoc = libxmljs.parseXml(
    allegedXML,
    {
      nonet: true,
      validateAttributes: true,
    }
  );
  if (xmlDoc.errors.length) {
    throw new Error(`XML errors:\n${xmlDoc.errors.join('\n')}`);
  }
  if (xmlDoc.validationErrors.length) {
    throw new Error(`Validation errors:\n${xmlDoc.validationErrors.join('\n')}`);
  }
  return true;
}

function palatableXML(allegedXML) {
  isPalatableXML(allegedXML);
  return allegedXML;
}

describe('Validity of form testdata XML', () => {
  it('should be well-formed XML', () => {
    getStrings(testXML.forms).forEach(([stack, str]) => {
      try {
        isPalatableXML(str);
      } catch (err) {
        const myErr = new Error(`Invalid XML encountered at forms.${stack.join('.')}`);
        myErr.cause = err;
        throw myErr;
      }
    });
  });
});

module.exports = palatableXML;
