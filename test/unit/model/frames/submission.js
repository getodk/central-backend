const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { Submission } = require(appRoot + '/lib/model/frames');
const streamTest = require('streamtest').v2;

describe('Submission', () => {
  describe('fromXml', () => {
    /* gh #45 when we have a real xml validator we should re-enable this test:
    it('should reject invalid xml', () =>
      Submission.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
      }));*/

    it('should reject if the formId does not exist (1: no attribute)', () =>
      Submission.fromXml('<data><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
      }));

    it('should reject if the formId does not exist (2: blank)', () =>
      Submission.fromXml('<data id=""><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
      }));

    it('should find instanceID in meta', () =>
      Submission.fromXml('<data id="mycoolform"><orx:meta><orx:instanceID>idtest</orx:instanceID></orx:meta><field/></data>').then((partial) => {
        partial.instanceId.should.equal('idtest');
      }));

    it('should find instanceID directly in data envelope', () =>
      Submission.fromXml('<data id="mycoolform"><instanceID>idtest</instanceID><field/></data>').then((partial) => {
        partial.instanceId.should.equal('idtest');
      }));

    it('should generate an instance id if not found', () =>
      Submission.fromXml('<data id="mycoolform"><field/></data>').then((partial) => {
        partial.instanceId.should.be.a.uuid();
      }));

    it('should reject if encryption is given but no instanceID', () => {
      const xml = '<data id="build_basic_1582152194" version="[encrypted:AXBggUDR]" encrypted="yes" xmlns="http://www.opendatakit.org/xforms/encrypted"><base64EncryptedKey>abc4A==</base64EncryptedKey></data>';
      return Submission.fromXml(xml).should.be.rejected();
    });

    it('should return a populated Submission given correct xml', () => {
      const xml = '<data id="mycoolform" version="coolest"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return Submission.fromXml(xml).then((partial) => {
        partial.xmlFormId.should.equal('mycoolform');
        partial.instanceId.should.equal('myinstance');
        partial.def.version.should.equal('coolest');
        partial.xml.should.equal(xml);
      });
    });

    it('should detect instanceName if given', () => {
      const xml = '<data id="mycoolform" version="coolest"><orx:meta><orx:instanceID>myinstance</orx:instanceID><orx:instanceName>my name</orx:instanceName></orx:meta><field/></data>';
      return Submission.fromXml(xml).then((partial) => {
        partial.def.instanceName.should.equal('my name');
      });
    });

    it('should squash null version to empty-string', () => {
      const xml = '<data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return Submission.fromXml(xml).then((partial) => {
        (partial.def.version === '').should.equal(true);
      });
    });

    it('should work given an xml preamble', () => {
      const xml = '<?xml version="1.0"?><data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return Submission.fromXml(xml).then((partial) => {
        partial.xmlFormId.should.equal('mycoolform');
        partial.instanceId.should.equal('myinstance');
        partial.xml.should.equal(xml);
      });
    });

    it('should find the appropriate localKey even if the chunk splits', () => {
      const xml = streamTest.fromChunks([ '<data id="build_basic_1582152194" version="[encrypted:AXBggUDR]" encrypted="yes" xmlns="http://www.opendatakit.org/xforms/encrypted"><base64EncryptedKey>BGCUNCNPLPFSYOO8lKWsVROLlVDqF8CVxcC5zTQAbByA2f9o/24iUMpPCLCWEf05Rv9wTB17k2QdKaaUaK1ry0FcQJ46OzVAv+snjwaDcbZMB+5EM/mxZY/OtHxhjD+CIpsTHK6VtImW5VZGrWtKQ0TooTivBWo1YKb05gHNRhAy9wksdUAP+7I', 'Y3daKQ+SCitBr8g9Fa8Zt0oeRbzxGP3Uo2u3PBH0YZdeUVPjLgGpYYnSbLeX1I+3AgDw6xobYCnlMlFd4vC2ZHGEgYNz9/syg4xiYRbzjElFFqrEqvKbBySymfbF3RoblhwXFWai3u+YApCYuJup6IwYvGNKRAQ==</base64EncryptedKey><orx:meta xmlns:orx="http://openrosa.org/xforms"><orx:instanceID></orx:instanceID></orx:meta><media><file>u4cnPKejqTlUpQGn.png.enc</file></media><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><base64EncryptedElementSignature>u+OhZZZ9piU/+hqncjavZT5aPaI/dvmX3I7LBw8nq0NQ+1MDOmS37P+/YYBBLdNHA2edkm3k0rjkzSd7ggGlTOW2z3Gn1L5U3tnyIFlRcsvKqYF90x5LFZLjrJ52Gbu51Xplal8tlj1cq3TVRkHv+nvoD1YdKVSglb/uVMkkRL9CVAeJtFujrbph5DcTJrb58QTvP87+b8atEaGfBOedCacGcfjbHAxzKKc8c0CPPjlXtCLgvOGXmQtZNdjF/Y2SP1D5f9J2CGkR9rxg9FXBuwoh3DVwObnRZc3dPvmxGiGw9B502jIuZgp38qK0IM9hjgvT7/hzYdoCSqi/STIo4A==</base64EncryptedElementSignature><meta><instanceID>encrypted</instanceID></meta></data>' ]);
      return Submission.fromXml(xml).then((partial) => {
        partial.def.localKey.should.equal('BGCUNCNPLPFSYOO8lKWsVROLlVDqF8CVxcC5zTQAbByA2f9o/24iUMpPCLCWEf05Rv9wTB17k2QdKaaUaK1ry0FcQJ46OzVAv+snjwaDcbZMB+5EM/mxZY/OtHxhjD+CIpsTHK6VtImW5VZGrWtKQ0TooTivBWo1YKb05gHNRhAy9wksdUAP+7IY3daKQ+SCitBr8g9Fa8Zt0oeRbzxGP3Uo2u3PBH0YZdeUVPjLgGpYYnSbLeX1I+3AgDw6xobYCnlMlFd4vC2ZHGEgYNz9/syg4xiYRbzjElFFqrEqvKbBySymfbF3RoblhwXFWai3u+YApCYuJup6IwYvGNKRAQ==');
      });
    });
  });
});

