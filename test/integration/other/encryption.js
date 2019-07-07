const appRoot = require('app-root-path');
const should = require('should');
const { toText } = require('streamtest').v2;
const { testService, testContainer } = require(appRoot + '/test/integration/setup');
const testData = require(appRoot + '/test/data/xml');
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');

describe('managed encryption', () => {
  describe('lock management', () => {
    it('should reject keyless forms in keyed projects @slow', testContainer(async (container) => {
      // enable managed encryption.
      await container.transacting(({ Project }) =>
        Project.getById(1).then((o) => o.get())
          .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')));

      // now attempt to create a keyless form.
      let error;
      await container.transacting(({ Project, FormPartial }) =>
        Promise.all([
          Project.getById(1).then((o) => o.get()),
          FormPartial.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
          .catch((err) => { error = err; })
      );

      error.problemCode.should.equal(409.5);
    }));

    it('should reject forms created while project managed encryption is being enabled @slow', testContainer(async (container) => {
      // enable managed encryption but don't allow the transaction to close.
      let encReq;
      const unblock = await new Promise((resolve) => {
        encReq = container.transacting(({ Project }) => Promise.all([
          Project.getById(1).then((o) => o.get())
            .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')),
          new Promise(resolve)
        ]));
      });

      // now we have to wait until the above query actually takes the necessary lock.
      const lockQuery = "select count(*) from pg_locks join pg_class on pg_locks.relation = pg_class.oid where pg_class.relname = 'form_defs' and pg_locks.granted = true;";
      const locked = () => container.db.raw(lockQuery).then(({ rows }) => rows[0].count > 0);
      const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const check = () => locked().then((isLocked) => isLocked
        ? true
        : wait(10).then(check));
      await check();

      // now that we are sure the lock has been taken, try to create the form.
      let error;
      const formReq = container.transacting(({ Project, FormPartial }) =>
        Promise.all([
          Project.getById(1).then((o) => o.get()),
          FormPartial.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
          .catch((err) => { error = err; })
      );

      // now unblock the managed encryption commit and let it all flush through.
      unblock();
      await formReq;
      await encReq;

      // now make sure we get the error we wanted.
      error.problemCode.should.equal(409.5);
    }));
  });

  describe('decryptor', () => {
    const { makePubkey, encryptInstance } = require(appRoot + '/test/util/crypto-odk');
    const { generateKeypair, stripPemEnvelope } = require(appRoot + '/lib/util/crypto');

    it('should give a decryptor for the given passphrases', testService((service, { all, Key, SubmissionPartial, db }) =>
      Promise.all([ 'alpha', 'beta' ].map(generateKeypair))
        .then((pairs) =>
          all.mapSequential(
            pairs.map((private) => new Key({
              public: stripPemEnvelope(Buffer.from(private.pubkey, 'base64')),
              private,
              managed: true
            }))
              .concat([ new Key({ public: 'test' }) ]),
            (k) => k.create()
          )
          .then((keys) => Key.getDecryptor({ [keys[0].id]: 'alpha', [keys[1].id]: 'beta', [keys[2].id]: 'charlie' })
            .then((decryptor) => new Promise((done) => {
              // create alpha decrypt stream:
              const encAlpha = encryptInstance(makePubkey(keys[0].public), '', testData.instances.simple.one);
              const clearAlpha = decryptor(encAlpha.encInstance, keys[0].id, encAlpha.encAeskey.toString('base64'),
                'one', 0);

              // create beta decrypt stream:
              const encBeta = encryptInstance(makePubkey(keys[1].public), '', testData.instances.simple.two);
              const clearBeta = decryptor(encBeta.encInstance, keys[1].id, encBeta.encAeskey.toString('base64'),
                'two', 0);

              // verify no charlie:
              (decryptor(null, keys[2].id) === null).should.equal(true);

              clearAlpha.pipe(toText((_, textAlpha) => {
                textAlpha.should.equal(testData.instances.simple.one);

                clearBeta.pipe(toText((_, textBeta) => {
                  textBeta.should.equal(testData.instances.simple.two);
                  done();
                }));
              }));
            }))))));
  });

  describe('end-to-end', () => {
    const { extractPubkey, extractVersion, encryptInstance, sendEncrypted, internal } = require(appRoot + '/test/util/crypto-odk');

    describe('odk encryption simulation', () => {
      // because (sigh) there is so much code in crypto-odk just to simulate the
      // ODK Collect client encryption, i wouldn't feel right not.. testing.. the
      // test code....
      describe('oaep padding', () => {
        const { unpadPkcs1OaepMgf1Sha256 } = require(appRoot + '/lib/util/quarantine/oaep');
        it('should survive a round-trip', () => {
          const input = Buffer.from('0102030405060708090a0b0c0d0e0f1112131415161718191a1b1c1d1e1f2021', 'hex');
          const result = unpadPkcs1OaepMgf1Sha256(internal.padOaep(input));
          result.equals(Buffer.from('0102030405060708090a0b0c0d0e0f1112131415161718191a1b1c1d1e1f2021', 'hex'))
            .should.equal(true);
        });
      });

      describe('pkcs7 padding', () => {
        it('should pad appropriately', () => {
          internal.padPkcs7(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'))
            .equals(Buffer.from('000102030405060708090a0b0c0d0e0f10101010101010101010101010101010', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('000102030405060708090a0b0c0d0e', 'hex'))
            .equals(Buffer.from('000102030405060708090a0b0c0d0e01', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('00010203040506', 'hex'))
            .equals(Buffer.from('00010203040506090909090909090909', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('', 'hex'))
            .equals(Buffer.from('10101010101010101010101010101010', 'hex'))
            .should.equal(true);
        });
      });
    });

    it('should reject with a reasonable message given incorrect passphrase', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=wrong`)
            .expect(400)
            .then(({ body }) => { body.code.should.equal(400.12); })))));

    it('should decrypt to CSV successfully', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)
              .then(() => send(testData.instances.simple.two))
              .then(() => send(testData.instances.simple.three))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => new Promise((done) =>
            zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`), (result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.a.SimpleCsv();
              done();
            }))))));

    it('should decrypt with passphrases provide via url-encoded POST body', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)
              .then(() => send(testData.instances.simple.two))
              .then(() => send(testData.instances.simple.three))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => new Promise((done) =>
            zipStreamToFiles(asAlice.post(`/v1/projects/1/forms/simple/submissions.csv.zip`)
              .send(`${keyId}=supersecret`)
              .set('Content-Type', 'application/x-www-form-urlencoded'), (result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.a.SimpleCsv();
              done();
            }))))));

    it('should decrypt with passphrases provide via JSON POST body', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)
              .then(() => send(testData.instances.simple.two))
              .then(() => send(testData.instances.simple.three))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => new Promise((done) =>
            zipStreamToFiles(asAlice.post(`/v1/projects/1/forms/simple/submissions.csv.zip`)
              .send({ [keyId]: 'supersecret' }), (result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.a.SimpleCsv();
              done();
            }))))));

    it('should decrypt attached files successfully', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one, { alpha: 'hello this is file alpha', beta: 'and beta' })
              .then(() => send(testData.instances.simple.two, { charlie: 'file charlie is right here' }))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => new Promise((done) =>
            zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`), (result) => {
              result.filenames.length.should.equal(4);
              result.filenames.should.containDeep([ 'simple.csv', 'media/alpha', 'media/beta', 'media/charlie' ]);

              result['media/alpha'].should.equal('hello this is file alpha');
              result['media/beta'].should.equal('and beta');
              result['media/charlie'].should.equal('file charlie is right here');
              done();
            }))))));

    it('should handle mixed[encrypted/plaintext] source records', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
              .then((send) => send(testData.instances.simple.two)
                .then(() => send(testData.instances.simple.three))))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
              .expect(200)
              .then(({ body }) => body[0].id))
            .then((keyId) => new Promise((done) =>
              zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`), (result) => {
                result.filenames.should.eql([ 'simple.csv' ]);
                result['simple.csv'].should.be.a.SimpleCsv();
                done();
              })))))));

    it('should handle mixed[still-encrypted/plaintext] cases', testService((service, { Project, FormPartial }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
              .then((send) => send(testData.instances.simple.two)
                .then(() => send(testData.instances.simple.three))))
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip`), (result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(5); // header + 3 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'Status' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].should.eql([ '','','','three','5','Alice','not decrypted' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].should.eql([ '','','','two','5','Alice','not decrypted' ]);
                csv[3].shift().should.be.an.recentIsoDate();
                csv[3].should.eql([ 'one','Alice','30','one','5','Alice' ]);
                csv[4].should.eql([ '' ]);
                done();
              })))))));

    // we have to sort of cheat at this to get two different managed keys in effect.
    it('should handle mixed[managedA/managedB] source records', testService((service, { Project, FormPartial }) =>
      service.login('alice', (asAlice) =>
        // first enable managed encryption and submit submission one.
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)))

          // here's where we have to cheat:
          // 1 manually reset the project keyId to null
          // 2 manually force the formdef to be plaintext again
          .then(() => Project.getById(1).then((o) => o.get()))
          .then((project) => Promise.all([
            project.with({ keyId: null }).update(),
            Promise.all([
              project.getFormByXmlFormId('simple').then((o) => o.get()),
              FormPartial.fromXml(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            ])
              .then(([ form, partial ]) => partial.createVersion(form))
          ]))

          // now we can set managed encryption again and submit our last two submissions.
          .then(() => Project.getById(1).then((o) => o.get()))
          .then((project) => project.setManagedEncryption('superdupersecret'))
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.two)
              .then(() => send(testData.instances.simple.three))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body.map((key) => key.id)))
          .then((keyIds) => new Promise((done) =>
            zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyIds[1]}=supersecret&${keyIds[0]}=superdupersecret`), (result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.a.SimpleCsv();
              done();
            }))))));

    it('should handle mixed [missing-xml/plaintext] cases (decrypting)', testService((service, { Project, FormPartial }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => encryptInstance(extractPubkey(text), extractVersion(text), testData.instances.simple.two))
              .then(({ envelope }) => asAlice.post('/v1/projects/1/forms/simple/submissions')
                .send(envelope)
                .set('Content-Type', 'text/xml')
                .expect(200)))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
              .expect(200)
              .then(({ body }) => body[0].id))
            .then((keyId) => new Promise((done) =>
              zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?1=supersecret`), (result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(4); // header + 2 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'Status' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].should.eql([ '','','','two','5','Alice','missing encrypted form data' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].should.eql([ 'one','Alice','30','one','5','Alice' ]);
                csv[3].should.eql([ '' ]);
                done();
              })))))));

    it('should handle mixed [missing-xml/plaintext] cases (not decrypting)', testService((service, { Project, FormPartial }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => encryptInstance(extractPubkey(text), extractVersion(text), testData.instances.simple.two))
              .then(({ envelope }) => asAlice.post('/v1/projects/1/forms/simple/submissions')
                .send(envelope)
                .set('Content-Type', 'text/xml')
                .expect(200)))
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip`), (result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(4); // header + 2 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'Status' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].should.eql([ '','','','two','5','Alice','missing encrypted form data' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].should.eql([ 'one','Alice','30','one','5','Alice' ]);
                csv[3].should.eql([ '' ]);
                done();
              })))))));
  });
});

