import path from 'node:path';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { APIGatewayProxyResult } from 'aws-lambda';
import { build } from './build';
import { JudgeOpts } from '../src/endpoints/judge';
import { BROWSER_CONFIGS, DOCKER_CONTEXT } from './constants';
// @ts-ignore just importing a type
import type { Execa$ } from 'execa';

const sleep = promisify(setTimeout);

const execa = async () => {
  const { $ } = await import('execa');
  return $({
    stdio: 'inherit',
    cwd: DOCKER_CONTEXT,
    env: {
      ...process.env,
      DOCKER_BUILDKIT: '0',
    },
  });
};

const buildImage = async ($: Execa$, name: string) => {
  console.log('Building docker image...');
  const buildArgs = Object.entries(BROWSER_CONFIGS.firefox.dockerBuildArgs('119.0')).flatMap(([key, value]) => [
    '--build-arg',
    `${key}=${value}`,
  ]);
  const firefoxDockerfile = path.join(__dirname, '..', 'containers', 'firefox.Dockerfile');
  await $`docker build --tag ${name} --platform linux/amd64 --file ${firefoxDockerfile} ${buildArgs} .`;
};

const logStream = (prefix: string, stream: Readable) => {
  stream.setEncoding('utf-8');
  stream.on('data', (chunk: string) =>
    chunk.split(/\r?\n/).forEach(
      (line) =>
        line.trim().length &&
        process.stderr.write(
          `${prefix}: ${line
            // sometimes geckodriver emits ascii control characters which messes up the output
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
            // also collapse all whitespace down into a single space - easier to read
            .replace(/\s\s+/g, ' ')}\n`
        )
    )
  );
};

const runContainer = async ($: Execa$, name: string) => {
  const { default: c } = await import('chalk');

  console.log('Running...');
  const mount = `${path.join(__dirname, '..', 'dist', 'judge')}:/var/task`;
  // To manually inspect image:
  // "--interactive --tty --entrypoint /bin/bash",
  const proc = $({
    stdio: 'pipe',
  })`docker run --rm --name ${name} --platform linux/amd64 --publish 9000:8080 -v ${mount} ${name}`;
  logStream(c.yellow(`${name}[stdout]`), proc.stdout!);
  logStream(c.red(`${name}[stderr]`), proc.stderr!);

  const opts: JudgeOpts = {
    puzzleName: 'id',
    puzzleSource: 'function id(x) {\n  return x;\n}',
    solution: '!0',
  };

  await Promise.race([
    proc,
    (async () => {
      await sleep(1000);
      console.log('=== Making request', opts);
      const res = await fetch('http://localhost:9000/2015-03-31/functions/function/invocations', {
        method: 'POST',
        body: JSON.stringify({ body: btoa(JSON.stringify(opts)) }),
      });
      const data = (await res.json()) as APIGatewayProxyResult;
      console.log('=== data', data.statusCode, JSON.parse(data.body));
    })(),
  ]);

  proc.kill();
};

const main = async () => {
  const $ = await execa();
  const name = 'rttw-judge-dev';

  await build();
  await buildImage($, name);
  await runContainer($, name);
};

main();