import fs from 'node:fs';
import fetch, { fileFromSync } from 'node-fetch';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { basename } from 'node:path';
import { program } from 'commander';

const _log = (...args) => console.log('[benchmarker]', new Date().toTimeString().substring(0, 8), ...args);
const log  = (...args) => true  && _log('INFO',   ...args);
log.debug  = (...args) => false && _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => true  && _log('ERROR',  ...args);
log.report = (...args) => true  && _log('REPORT', ...args);

// TODO record response sizes and highlight differences (repeated GET requests at least should always have the same size)

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-u, --user-email <serverUrl>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'secret')
    .option('-f, --form-path <formPath>', 'Path to form file (XML, XLS, XLSX etc.)', './250q-form.xml')
    .option('-t, --throughput <throughput>', 'Target throughput (in samples per "throughput period")', 50)
    .option('-p, --throughput-period <throughput-period>', 'Throughput period (in milliseconds)', 1_000)
    .option('-d, --test-duration <test-duration>', 'Test duration (in milliseconds)', 30_000)
    .option('-L, --log-directory <log-directory>', 'Log output directory (this should be an empty or non-existent directory)')
//    .option('-S, --test-in-series',   'Allow connecting to server in series', false)
//    .option('-P, --test-in-parallel', 'Allow connecting to server in parallel', true)
//    .option('-n, --submission-count <n>', 'Number of form submissions to generate', 5)
//    .option('-x, --export-count <x>',     'Number of exports', 5)
    ;
program.parse();
const { serverUrl, userEmail, userPassword, formPath, throughput, throughputPeriod, testDuration, logDirectory } = program.opts();

log(`Using form: ${formPath}`);
log(`Connecting to ${serverUrl} with user ${userEmail}...`);

const logPath = logDirectory || `./logs/${new Date().toISOString()}`;

let bearerToken;

benchmark();

async function benchmark() {
  log.info('Setting up...');

  log.info('Creating log directory:', logPath, '...');
  fs.mkdirSync(logPath);

  log.info('Creating session...');
  const { token } = await apiPostJson('sessions', { email:userEmail, password:userPassword }, { Authorization:null });
  bearerToken = token;

  log.info('Creating project...');
  const { id:projectId } = await apiPostJson('projects', { name:`benchmark-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId:formId } = await apiPostFile(`projects/${projectId}/forms`, formPath);

  log.info('Publishing form...');
  await apiPost(`projects/${projectId}/forms/${formId}/draft/publish`);

  log.info('Setup complete.  Starting benchmarks...');

  await doBenchmark('randomSubmission', throughput, throughputPeriod, testDuration, 100, n => randomSubmission(n, projectId, formId));

  // TODO should work out a more scientific sleep duration
  const backgroundJobPause = 20_000;
  log.info(`Sleeping ${durationForHumans(backgroundJobPause)} to allow central-backend to complete background jobs...`);
  await new Promise(resolve => setTimeout(resolve, backgroundJobPause));
  log.info('Woke up.');

//  const projectId = 545;
//  const formId = '250_questions';

  await doBenchmark('exportZipWithDataAndMedia', 10, 3_000, 60_000, 10, n => exportZipWithDataAndMedia(n, projectId, formId));

  log.info(`Check for extra logs at ${logPath}`);

  log.info('Complete.');
}

function doBenchmark(name, throughput, throughputPeriod, testDuration, minimumSuccessThreshold, fn) {
  log.info('Starting benchmark:', name);
  log.info('        throughput:', throughput, 'per period');
  log.info('  throughputPeriod:', throughputPeriod, 'ms');
  log.info('      testDuration:', durationForHumans(testDuration));
  log.info('-------------------------------');
  return new Promise((resolve, reject) => {
    try {
      const successes = [];
      const sizes = [];
      const fails = [];
      const results = [];
      const sleepyTime = +throughputPeriod / +throughput;

      let iterationCount = 0;
      const iterate = async () => {
        const n = iterationCount++;
        try {
          const start = Date.now();
          const size = await fn(n);
          const time = Date.now() - start;
          successes.push(time);
          sizes.push(size);
          results[n] = { success:true, time, size };
        } catch(err) {
          fails.push(err.message);
          results[n] = { success:false, err:{ message:err.message, stack:err.stack } };
        }
      };

      iterate();
      const timerId = setInterval(iterate, sleepyTime);

      setTimeout(async () => {
        clearTimeout(timerId);

        const maxDrainDuration = 120_000;
        await new Promise(resolve => {
          log.info(`Waiting up to ${durationForHumans(maxDrainDuration)} for test drainage...`);
          const maxDrainTimeout = Date.now() + maxDrainDuration;
          const drainPulse = 500;

          checkDrain();

          function checkDrain() {
            log.debug('Checking drain status...');
            if(Date.now() > maxDrainTimeout) {
              log.info('Drain timeout exceeded.');
              return resolve();
            } else if(results.length >= iterationCount) {
              log.info('All connections have completed.');
              return resolve();
            }
            log.debug(`Drainage not complete.  Still Waiting for ${iterationCount - results.length} connections.  Sleeping for ${durationForHumans(drainPulse)}...`);
            setTimeout(checkDrain, drainPulse);
          }
        });

        fs.writeFileSync(`${logPath}/${name}.extras.log.json`, JSON.stringify(results, null, 2));

        const successPercent = 100 * successes.length / iterationCount;

        log.report('--------------------------');
        log.report('              Test:', name);
        log.report('     Test duration:', testDuration);
        log.report('    Total requests:', iterationCount);
        log.report('Success % required:', `${minimumSuccessThreshold}%`);
        log.report('         Successes:', successes.length, `(${successPercent.toFixed(0)}%)`);
        log.report('        Throughput:', (1000 * successes.length / testDuration).toFixed(1), 'reqs/s');
        log.report('          Failures:', fails.length);
        log.report('    Response times:');
        log.report('              mean:', durationForHumans(_.mean(successes)));
        log.report('               min:', _. min(successes), 'ms');
        log.report('               max:', _. max(successes), 'ms');
        log.report('    Response sizes:');
        log.report('               min:', _. min(sizes), 'b');
        log.report('               max:', _. max(sizes), 'b');
        if(fails.length) log.report('            Errors:');
        [ ...new Set(fails) ].map(m => log.report(`              * ${m.replace(/\n/g, '\\n')}`));
        log.report('--------------------------');

        if(_.min(sizes) !== _.max(sizes)) reportFatalError('VARIATION IN RESPONSE SIZES MAY INDICATE SERIOUS ERRORS SERVER-SIDE');

        if(successPercent < minimumSuccessThreshold) reportFatalError('MINIMUM SUCCESS THRESHOLD WAS NOT MET');

        if(fails.length) reportWarning('REQUEST FAILURES MAY AFFECT SUBSEQUENT BENCHMARKS');

        resolve();
      }, +testDuration);
    } catch(err) {
      reject(err);
    }
  });
}

function reportFatalError(message) {
  reportWarning(message);
  process.exit(1);
}

function reportWarning(message) {
  log.report('!!!');
  log.report('!!!');
  log.report(`!!! ${message}!`);
  log.report('!!!');
  log.report('!!!');
  log.report('--------------------------');
}

async function time(sectionTitle, fn) {
  log.debug('Starting section:', sectionTitle);
  const startTime = Date.now();
  await fn();
  const endTime = Date.now();
  log.report('Section completed:', sectionTitle);
  log.report('       Time taken:', endTime - startTime, 'ms');
  log.report('---------------------------------------------');
}

function apiPostFile(path, filePath) {
  const mimeType = mimetypeFor(filePath);
  const blob = fileFromSync(filePath, mimeType);
  return apiPost(path, blob, { 'Content-Type':mimeType });
}

function apiPostJson(path, body, headers) {
  return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
}

function apiGetAndDump(prefix, n, path, headers) {
  return fetchToFile(prefix, n, 'GET', path, undefined, headers);
}

function apiPostAndDump(prefix, n, path, body, headers) {
  return fetchToFile(prefix, n, 'POST', path, body, headers);
}

async function fetchToFile(filenamePrefix, n, method, path, body, headers) {
  const res = await apiFetch(method, path, body, headers);

  return new Promise((resolve, reject) => {
    try {
      let bytes = 0;
      res.body.on('data', data => bytes += data.length);
      res.body.on('error', reject);

      const file = fs.createWriteStream(`${logPath}/${filenamePrefix}.${n.toString().padStart(9, '0')}.dump`);
      res.body.on('end', () => file.close(() => resolve(bytes)));

      file.on('error', reject);

      res.body.pipe(file);
    } catch(err) {
      console.log(err);
      process.exit(99);
    }
  });
}

async function apiPost(path, body, headers) {
  const res = await apiFetch('POST', path, body, headers);
  return res.json();
}

async function apiFetch(method, path, body, headers) {
  const url = `${serverUrl}/v1/${path}`;

  const Authorization = bearerToken ? `Bearer ${bearerToken}` : `Basic ${base64(`${userEmail}:${userPassword}`)}`;

  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization, ...headers },
  });
  log.debug(method, res.url, '->', res.status);
  if(!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function mimetypeFor(f) {
  const extension = fileExtensionFrom(f);
  log.debug('fileExtensionFrom()', f, '->', extension);
  switch(extension) {
    case 'xls' : return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xml' : return 'application/xml';
    default: throw new Error(`Unsure what mime type to use for: ${f}`);
  }
}

function fileExtensionFrom(f) {
  try {
    return basename(f).match(/\.([^.]*)$/)[1];
  } catch(err) {
    throw new Error(`Could not get file extension from filename '${f}'!`);
  }
}

function randomSubmission(n, projectId, formId) {
  const headers = {
    'Content-Type': 'multipart/form-data; boundary=foo',
    'X-OpenRosa-Version': '1.0',
  };

  const body = `--foo\r
Content-Disposition: form-data; name="xml_submission_file"; filename="submission.xml"\r
Content-Type: application/xml\r
\r
<data id="250_questions">
  <meta><instanceID>uuid:${uuid()}</instanceID></meta>
  <q1>${r()}</q1><q2>${r()}</q2><q3>${r()}</q3><q4>${r()}</q4><q5>${r()}</q5><q6>${r()}</q6><q7>${r()}</q7><q8>${r()}</q8><q9>${r()}</q9><q10>${r()}</q10><q11>${r()}</q11><q12>${r()}</q12><q13>${r()}</q13><q14>${r()}</q14><q15>${r()}</q15><q16>${r()}</q16><q17>${r()}</q17><q18>${r()}</q18><q19>${r()}</q19><q20>${r()}</q20><q21>${r()}</q21><q22>${r()}</q22><q23>${r()}</q23><q24>${r()}</q24><q25>${r()}</q25><q26>${r()}</q26><q27>${r()}</q27><q28>${r()}</q28><q29>${r()}</q29><q30>${r()}</q30><q31>${r()}</q31><q32>${r()}</q32><q33>${r()}</q33><q34>${r()}</q34><q35>${r()}</q35><q36>${r()}</q36><q37>${r()}</q37><q38>${r()}</q38><q39>${r()}</q39><q40>${r()}</q40><q41>${r()}</q41><q42>${r()}</q42><q43>${r()}</q43><q44>${r()}</q44><q45>${r()}</q45><q46>${r()}</q46><q47>${r()}</q47><q48>${r()}</q48><q49>${r()}</q49><q50>${r()}</q50>
  <q51>${r()}</q51><q52>${r()}</q52><q53>${r()}</q53><q54>${r()}</q54><q55>${r()}</q55><q56>${r()}</q56><q57>${r()}</q57><q58>${r()}</q58><q59>${r()}</q59><q60>${r()}</q60><q61>${r()}</q61><q62>${r()}</q62><q63>${r()}</q63><q64>${r()}</q64><q65>${r()}</q65><q66>${r()}</q66><q67>${r()}</q67><q68>${r()}</q68><q69>${r()}</q69><q70>${r()}</q70><q71>${r()}</q71><q72>${r()}</q72><q73>${r()}</q73><q74>${r()}</q74><q75>${r()}</q75><q76>${r()}</q76><q77>${r()}</q77><q78>${r()}</q78><q79>${r()}</q79><q80>${r()}</q80><q81>${r()}</q81><q82>${r()}</q82><q83>${r()}</q83><q84>${r()}</q84><q85>${r()}</q85><q86>${r()}</q86><q87>${r()}</q87><q88>${r()}</q88><q89>${r()}</q89><q90>${r()}</q90><q91>${r()}</q91><q92>${r()}</q92><q93>${r()}</q93><q94>${r()}</q94><q95>${r()}</q95><q96>${r()}</q96><q97>${r()}</q97><q98>${r()}</q98><q99>${r()}</q99><q100>${r()}</q100>
  <q101>${r()}</q101><q102>${r()}</q102><q103>${r()}</q103><q104>${r()}</q104><q105>${r()}</q105><q106>${r()}</q106><q107>${r()}</q107><q108>${r()}</q108><q109>${r()}</q109><q110>${r()}</q110><q111>${r()}</q111><q112>${r()}</q112><q113>${r()}</q113><q114>${r()}</q114><q115>${r()}</q115><q116>${r()}</q116><q117>${r()}</q117><q118>${r()}</q118><q119>${r()}</q119><q120>${r()}</q120><q121>${r()}</q121><q122>${r()}</q122><q123>${r()}</q123><q124>${r()}</q124><q125>${r()}</q125><q126>${r()}</q126><q127>${r()}</q127><q128>${r()}</q128><q129>${r()}</q129><q130>${r()}</q130><q131>${r()}</q131><q132>${r()}</q132><q133>${r()}</q133><q134>${r()}</q134><q135>${r()}</q135><q136>${r()}</q136><q137>${r()}</q137><q138>${r()}</q138><q139>${r()}</q139><q140>${r()}</q140><q141>${r()}</q141><q142>${r()}</q142><q143>${r()}</q143><q144>${r()}</q144><q145>${r()}</q145><q146>${r()}</q146><q147>${r()}</q147><q148>${r()}</q148><q149>${r()}</q149><q150>${r()}</q150>
  <q151>${r()}</q151><q152>${r()}</q152><q153>${r()}</q153><q154>${r()}</q154><q155>${r()}</q155><q156>${r()}</q156><q157>${r()}</q157><q158>${r()}</q158><q159>${r()}</q159><q160>${r()}</q160><q161>${r()}</q161><q162>${r()}</q162><q163>${r()}</q163><q164>${r()}</q164><q165>${r()}</q165><q166>${r()}</q166><q167>${r()}</q167><q168>${r()}</q168><q169>${r()}</q169><q170>${r()}</q170><q171>${r()}</q171><q172>${r()}</q172><q173>${r()}</q173><q174>${r()}</q174><q175>${r()}</q175><q176>${r()}</q176><q177>${r()}</q177><q178>${r()}</q178><q179>${r()}</q179><q180>${r()}</q180><q181>${r()}</q181><q182>${r()}</q182><q183>${r()}</q183><q184>${r()}</q184><q185>${r()}</q185><q186>${r()}</q186><q187>${r()}</q187><q188>${r()}</q188><q189>${r()}</q189><q190>${r()}</q190><q191>${r()}</q191><q192>${r()}</q192><q193>${r()}</q193><q194>${r()}</q194><q195>${r()}</q195><q196>${r()}</q196><q197>${r()}</q197><q198>${r()}</q198><q199>${r()}</q199><q200>${r()}</q200>
  <q201>${r()}</q201><q202>${r()}</q202><q203>${r()}</q203><q204>${r()}</q204><q205>${r()}</q205><q206>${r()}</q206><q207>${r()}</q207><q208>${r()}</q208><q209>${r()}</q209><q210>${r()}</q210><q211>${r()}</q211><q212>${r()}</q212><q213>${r()}</q213><q214>${r()}</q214><q215>${r()}</q215><q216>${r()}</q216><q217>${r()}</q217><q218>${r()}</q218><q219>${r()}</q219><q220>${r()}</q220><q221>${r()}</q221><q222>${r()}</q222><q223>${r()}</q223><q224>${r()}</q224><q225>${r()}</q225><q226>${r()}</q226><q227>${r()}</q227><q228>${r()}</q228><q229>${r()}</q229><q230>${r()}</q230><q231>${r()}</q231><q232>${r()}</q232><q233>${r()}</q233><q234>${r()}</q234><q235>${r()}</q235><q236>${r()}</q236><q237>${r()}</q237><q238>${r()}</q238><q239>${r()}</q239><q240>${r()}</q240><q241>${r()}</q241><q242>${r()}</q242><q243>${r()}</q243><q244>${r()}</q244><q245>${r()}</q245><q246>${r()}</q246><q247>${r()}</q247><q248>${r()}</q248><q249>${r()}</q249><q250>${r()}</q250>
</data>
\r
--foo--`;

  return apiPostAndDump('randomSubmission', n, `projects/${projectId}/forms/${formId}/submissions`, body, headers);
}

function r() {
  return Math.floor(Math.random() * 9999);
}

function nPromises(n, fn) {
  return Promise.all(Array.from(Array(+n)).map(fn));
}

function exportZipWithDataAndMedia(n, projectId, formId) {
  return apiGetAndDump('exportZipWithDataAndMedia', n, `projects/${projectId}/forms/${formId}/submissions.csv.zip?splitSelectMultiples=true&groupPaths=true&deletedFields=true`);
}

function durationForHumans(ms) {
  if(ms > 1000) return (ms / 1000).toFixed(1) + 's';
  return ms + 'ms';
}
