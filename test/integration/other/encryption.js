const appRoot = require('app-root-path');
const { readFileSync } = require('fs');
const { sql } = require('slonik');
const { toText } = require('streamtest').v2;
// eslint-disable-next-line import/no-dynamic-require
const { testService, testContainerFullTrx, testContainer } = require(appRoot + '/test/integration/setup');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { pZipStreamToFiles } = require(appRoot + '/test/util/zip');
// eslint-disable-next-line import/no-dynamic-require
const { Form, Key, Submission } = require(appRoot + '/lib/model/frames');
// eslint-disable-next-line import/no-dynamic-require
const { mapSequential } = require(appRoot + '/test/util/util');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('managed encryption', () => {
  describe('lock management', () => {
    it('should reject keyless forms in keyed projects @slow', testContainerFullTrx(async (container) => {
      // enable managed encryption.
      await container.transacting(({ Projects }) =>
        Projects.getById(1).then((o) => o.get())
          .then((project) => Projects.setManagedEncryption(project, 'supersecret', 'it is a secret')));

      // now attempt to create a keyless form.
      let error;
      await container.transacting(({ Forms, Projects }) =>
        Promise.all([
          Projects.getById(1).then((o) => o.get()),
          Form.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => Forms.createNew(partial, project))
          .catch((err) => { error = err; })
      ); // eslint-disable-line function-paren-newline

      error.problemCode.should.equal(409.5);
    }));

    it('should reject forms created while project managed encryption is being enabled @slow', testContainerFullTrx(async (container) => {
      // enable managed encryption but don't allow the transaction to close.
      let encReq;
      const unblock = await new Promise((resolve) => {
        encReq = container.transacting(({ Projects }) => Promise.all([
          Projects.getById(1).then((o) => o.get())
            .then((project) => Projects.setManagedEncryption(project, 'supersecret', 'it is a secret')),
          new Promise(resolve) // <- we want unblock to be the function that resolves this inner Promise.
        ]));
      });

      // now we have to wait until the above query actually takes the necessary lock.
      const lockQuery = sql`select count(*) from pg_locks join pg_class on pg_locks.relation = pg_class.oid where pg_class.relname = 'form_defs' and pg_locks.granted = true;`;
      const locked = () => container.oneFirst(lockQuery).then((count) => Number(count) > 0);
      const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      // eslint-disable-next-line no-confusing-arrow
      const check = () => locked().then((isLocked) => isLocked
        ? true
        : wait(10).then(check));
      await check();

      // now that we are sure the lock has been taken, try to create the form.
      let error;
      const formReq = container.transacting(({ Projects, Forms }) =>
        Promise.all([
          Projects.getById(1).then((o) => o.get()),
          Form.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => Forms.createNew(partial, project))
          .catch((err) => { error = err; })
      ); // eslint-disable-line function-paren-newline

      // now unblock the managed encryption commit and let it all flush through.
      unblock();
      await formReq;
      await encReq;

      // now make sure we get the error we wanted.
      error.problemCode.should.equal(409.5);
    }));
  });

  describe('decryptor', () => {
    // eslint-disable-next-line import/no-dynamic-require
    const { makePubkey, encryptInstance } = require(appRoot + '/test/util/crypto-odk');
    // eslint-disable-next-line import/no-dynamic-require
    const { generateManagedKey, stripPemEnvelope } = require(appRoot + '/lib/util/crypto');

    it('should give a decryptor for the given passphrases', testService((service, { Keys }) =>
      Promise.all([ 'alpha', 'beta' ].map(generateManagedKey))
        .then((pairs) =>
          mapSequential(
            pairs.map((priv) => new Key({
              public: stripPemEnvelope(Buffer.from(priv.pubkey, 'base64')),
              private: priv,
              managed: true
            }))
              .concat([ new Key({ public: 'test' }) ]),
            Keys.create
          )
            .then((keys) => Keys.getDecryptor({ [keys[0].id]: 'alpha', [keys[1].id]: 'beta', [keys[2].id]: 'charlie' })
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

                  // eslint-disable-next-line no-shadow
                  clearBeta.pipe(toText((_, textBeta) => {
                    textBeta.should.equal(testData.instances.simple.two);
                    done();
                  }));
                }));
              }))))));
  });

  describe('encrypted submission attachment parsing', () => {
    it('should correctly record attachment file ordering', testContainer((container) => {
      const xml = `<submission id="simple">
  <meta><instanceID>uuid:ad4e5c2a-9637-4bdf-80f5-0157243f8fac</instanceId></meta>
  <base64EncryptedKey>key</base64EncryptedKey>
  <encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
  <media><file>zulu.file</file></media>
  <media><file>alpha.file</file></media>
  <media><file>bravo.file</file></media>
</submission>`;

      // hijack the run routine.
      const results = [];
      const db = { query: (x) => { results.push(x); return Promise.resolve(); } };
      const hijacked = container.with({ db });

      return Submission.fromXml(xml)
        .then((partial) => hijacked.SubmissionAttachments.create(partial, {}, []))
        .then(() => {
          results[0].values.should.eql([
            null, null, 'zulu.file', 0, false,
            null, null, 'alpha.file', 1, false,
            null, null, 'bravo.file', 2, false,
            null, null, 'submission.xml.enc', 3, null
          ]);
        });
    }));
  });

  describe('end-to-end', () => {
    // eslint-disable-next-line import/no-dynamic-require
    const { extractPubkey, extractVersion, encryptInstance, sendEncrypted, internal } = require(appRoot + '/test/util/crypto-odk');

    describe('odk encryption simulation', () => {
      // because (sigh) there is so much code in crypto-odk just to simulate the
      // ODK Collect client encryption, i wouldn't feel right not.. testing.. the
      // test code....
      describe('oaep padding', () => {
        // eslint-disable-next-line import/no-dynamic-require
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
          .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.an.EncryptedSimpleCsv();
            })))));

    it('should decrypt to CSV successfully as a direct root table', testService((service) =>
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
          .then((keyId) => asAlice.get(`/v1/projects/1/forms/simple/submissions.csv?${keyId}=supersecret`)
            .expect(200)
            .then(({ text }) => { text.should.be.an.EncryptedSimpleCsv(); })))));

    it('should decrypt with passphrases provided via url-encoded POST body', testService((service) =>
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
          .then((keyId) => pZipStreamToFiles(asAlice.post('/v1/projects/1/forms/simple/submissions.csv.zip')
            .send(`${keyId}=supersecret`)
            .set('Content-Type', 'application/x-www-form-urlencoded'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.an.EncryptedSimpleCsv();
            })))));

    it('should decrypt over cookie auth with passphrases provided via url-encoded POST body', testService((service) =>
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
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
              .expect(200)
              .then(({ body }) => body[0].id),
            service.post('/v1/sessions')
              .send({ email: 'alice@getodk.org', password: 'alice' })
              .expect(200)
              .then(({ body }) => body)
          ]))
          .then(([ keyId, session ]) => pZipStreamToFiles(service.post('/v1/projects/1/forms/simple/submissions.csv.zip')
            .send(`${keyId}=supersecret&__csrf=${session.csrf}`)
            .set('Cookie', `__Host-session=${session.token}`)
            .set('X-Forwarded-Proto', 'https')
            .set('Content-Type', 'application/x-www-form-urlencoded'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.an.EncryptedSimpleCsv();
            })))));

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
          .then((keyId) => pZipStreamToFiles(asAlice.post('/v1/projects/1/forms/simple/submissions.csv.zip')
            .send({ [keyId]: 'supersecret' }))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result['simple.csv'].should.be.an.EncryptedSimpleCsv();
            })))));

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
          .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`))
            .then((result) => {
              result.filenames.length.should.equal(4);
              result.filenames.should.containDeep([ 'simple.csv', 'media/alpha', 'media/beta', 'media/charlie' ]);

              result['media/alpha'].should.equal('hello this is file alpha');
              result['media/beta'].should.equal('and beta');
              result['media/charlie'].should.equal('file charlie is right here');
            })))));

    it('should strip .enc suffix from decrypted attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one, { 'testfile.jpg.enc': 'hello this is a suffixed file' }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
              .expect(200)
              .then(({ body }) => body[0].id))
            .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`))
              .then((result) => {
                result.filenames.length.should.equal(2);
                result.filenames.should.containDeep([ 'simple.csv', 'media/testfile.jpg' ]);

                result['media/testfile.jpg'].should.equal('hello this is a suffixed file');
              }))))));

    it('should decrypt client audit log attachments', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.clientAudits)
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/audits.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.clientAudits.one, { 'audit.csv.enc': readFileSync(appRoot + '/test/data/audit.csv') })
              .then(() => send(testData.instances.clientAudits.two, { 'audit.csv.enc': readFileSync(appRoot + '/test/data/audit2.csv') }))))
          .then(() => exhaust(container))
          .then(() => container.oneFirst(sql`select count(*) from client_audits`)
            .then((count) => { count.should.equal(0); }))
          .then(() => container.oneFirst(sql`select count(*) from audits
            where action='submission.attachment.update' and processed is not null and failures = 0`)
            .then((count) => { count.should.equal(4); })))));

    it('should decrypt client audit log attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.clientAudits)
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/audits.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.clientAudits.one, { 'audit.csv.enc': readFileSync(appRoot + '/test/data/audit.csv') })
              .then(() => send(testData.instances.clientAudits.two, { 'audit.csv.enc': readFileSync(appRoot + '/test/data/audit2.csv') }))))
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/audits/submissions.csv.zip?${keyId}=supersecret`))
            .then((result) => {
              result.filenames.should.containDeep([
                'audits.csv',
                'media/audit.csv',
                'media/audit.csv',
                'audits - audit.csv'
              ]);

              result['audits - audit.csv'].should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii
two,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb
two,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd
two,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff
`);
            })))));

    it('should handle mixed [plaintext/encrypted] attachments (not decrypting)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.binaryType)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/bone/attachments/my_file1.mp4')
            .send('this is file one')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.binaryType.two, { 'here_is_file2.jpg': 'file two you cant see' })))
          .then(() => pZipStreamToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'))
            .then((result) => {
              result.filenames.length.should.equal(2);
              result.filenames.should.containDeep([ 'binaryType.csv', 'media/my_file1.mp4' ]);

              result['media/my_file1.mp4'].should.equal('this is file one');
            })))));

    it('should handle mixed [plaintext/encrypted] attachments (decrypting)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.binaryType)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/bone/attachments/my_file1.mp4')
            .send('this is file one')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.binaryType.two, { 'here_is_file2.jpg': 'file two you can see' })))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/keys')
            .expect(200)
            .then(({ body }) => body[0].id))
          .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/binaryType/submissions.csv.zip?${keyId}=supersecret`))
            .then((result) => {
              result.filenames.length.should.equal(3);
              result.filenames.should.containDeep([ 'binaryType.csv', 'media/my_file1.mp4', 'media/here_is_file2.jpg' ]);

              result['media/my_file1.mp4'].should.equal('this is file one');
              result['media/here_is_file2.jpg'].should.equal('file two you can see');
            })))));

    it('should handle mixed[plaintext/encrypted] formdata (decrypting)', testService((service) =>
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
            .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);
                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(5); // header + 3 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[1].should.eql([ 'three','Chelsea','38','three','5','Alice','1','1','','','','0' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[2].should.eql([ 'two','Bob','34','two','5','Alice','1','1','','','','0' ]);
                csv[3].shift().should.be.an.recentIsoDate();
                // eslint-disable-next-line comma-spacing
                csv[3].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
                csv[4].should.eql([ '' ]);
              }))))));

    it('should handle mixed[plaintext/encrypted] formdata (not decrypting)', testService((service) =>
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
            .then(() => pZipStreamToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(5); // header + 3 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[1].should.eql([ '','','','three','5','Alice','1','1','not decrypted','','','0' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[2].should.eql([ '','','','two','5','Alice','1','1','not decrypted','','','0' ]);
                csv[3].shift().should.be.an.recentIsoDate();
                // eslint-disable-next-line comma-spacing
                csv[3].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
                csv[4].should.eql([ '' ]);
              }))))));

    // we have to sort of cheat at this to get two different managed keys in effect.
    it('should handle mixed[managedA/managedB] formdata (decrypting)', testService((service, { Forms, Projects }) =>
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
          .then(() => Projects.getById(1).then((o) => o.get()))
          .then((project) => Promise.all([
            Projects.update(project, { keyId: null }),
            Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()),
              Form.fromXml(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            ])
              .then(([ form, partial ]) => Forms.createVersion(partial, form, true))
          ]))

          // now we can set managed encryption again and submit our last two submissions.
          .then(() => Projects.getById(1).then((o) => o.get()))
          .then((project) => Projects.setManagedEncryption(project, 'superdupersecret'))
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.two)
              .then(() => send(testData.instances.simple.three))))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => body.map((key) => key.id)))
          .then((keyIds) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyIds[1]}=supersecret&${keyIds[0]}=superdupersecret`))
            .then((result) => {
              const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
              csv.length.should.equal(5); // header + 3 data rows + newline
              csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
              csv[1].shift().should.be.an.recentIsoDate();
              csv[1].pop().should.match(/^two\[encrypted:........\]$/);
              // eslint-disable-next-line comma-spacing
              csv[1].should.eql([ 'three','Chelsea','38','three','5','Alice','1','1','','','','0' ]);
              csv[2].shift().should.be.an.recentIsoDate();
              csv[2].pop().should.match(/^two\[encrypted:........\]$/);
              // eslint-disable-next-line comma-spacing
              csv[2].should.eql([ 'two','Bob','34','two','5','Alice','1','1','','','','0' ]);
              csv[3].shift().should.be.an.recentIsoDate();
              csv[3].pop().should.match(/^\[encrypted:........\]$/);
              // eslint-disable-next-line comma-spacing
              csv[3].should.eql([ 'one','Alice','30','one','5','Alice','1','1','','','','0' ]);
              csv[4].should.eql([ '' ]);
            })))));

    it('should handle mixed [plaintext/missing-encrypted-xml] formdata (decrypting)', testService((service) =>
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
            .then((keyId) => pZipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(4); // header + 2 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[1].should.eql([ '','','','two','5','Alice','0','1','missing encrypted form data','','','0' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                // eslint-disable-next-line comma-spacing
                csv[2].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
                csv[3].should.eql([ '' ]);
              }))))));

    it('should handle mixed [plaintext/missing-encrypted-xml] formdata (not decrypting)', testService((service) =>
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
            .then(() => pZipStreamToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(4); // header + 2 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].pop().should.match(/^\[encrypted:........\]$/);
                // eslint-disable-next-line comma-spacing
                csv[1].should.eql([ '','','','two','5','Alice','0','1','missing encrypted form data','','','0' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                // eslint-disable-next-line comma-spacing
                csv[2].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
                csv[3].should.eql([ '' ]);
              }))))));
  });
});

