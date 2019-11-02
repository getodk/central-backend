const should = require('should');

describe('submission', () => {
  describe('encrypted attachment management', () => {
    it('should correctly record attachment file ordering', () => {
      const { SubmissionPartial, SubmissionDef } = require('../../../../lib/model/package')
        .withDefaults();

      const xml = `<submission id="form">
  <meta><instanceID>uuid:ad4e5c2a-9637-4bdf-80f5-0157243f8fac</instanceId></meta>
  <base64EncryptedKey>key</base64EncryptedKey>
  <encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
  <media><file>zulu.file</file></media>
  <media><file>alpha.file</file></media>
  <media><file>bravo.file</file></media>
</submission>`;

      return SubmissionPartial.fromXml(xml)
        .then((partial) => SubmissionDef.fromData(partial))
        .then((def) => def.generateExpectedAttachments()) // normally wants a formdef but not for this path
        .then((attachments) => {
          attachments.map((att) => [ att.name, att.index ])
            .should.eql([
              [ 'zulu.file', 0 ],
              [ 'alpha.file', 1 ],
              [ 'bravo.file', 2 ],
              [ 'submission.xml.enc', 3 ]
            ]);
        });
    });
  });
});

