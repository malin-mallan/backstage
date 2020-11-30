/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs-extra';
import mockFs from 'mock-fs';
import { resolve as resolvePath } from 'path';
import { paths } from '../../lib/paths';
import { mapDependencies } from '../../lib/versioning';
import * as runObj from '../../lib/run';
import bump from './bump';
import { withLogCollector } from '@backstage/test-utils';

const REGISTRY_VERSIONS: { [name: string]: string } = {
  '@backstage/core': '1.0.6',
  '@backstage/core-api': '1.0.7',
  '@backstage/theme': '2.0.0',
};

const HEADER = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

`;

const lockfileMock = `${HEADER}
"@backstage/core@^1.0.5":
  version "1.0.6"
  dependencies:
    "@backstage/core-api" "^1.0.6"

"@backstage/core@^1.0.3":
  version "1.0.3"
  dependencies:
    "@backstage/core-api" "^1.0.3"

"@backstage/theme@^1.0.0":
  version "1.0.0"

"@backstage/core-api@^1.0.6":
  version "1.0.6"

"@backstage/core-api@^1.0.3":
  version "1.0.3"
`;

// This is the lockfile that we produce to unlock versions before we run yarn install
const lockfileMockResult = `${HEADER}
"@backstage/core@^1.0.5":
  version "1.0.6"
  dependencies:
    "@backstage/core-api" "^1.0.6"

"@backstage/theme@^1.0.0":
  version "1.0.0"
`;

describe('bump', () => {
  afterEach(() => {
    mockFs.restore();
    jest.resetAllMocks();
  });

  it('should bump backstage dependencies', async () => {
    // Make sure all modules involved in package discovery are in the module cache before we mock fs
    await mapDependencies(paths.targetDir);

    mockFs({
      '/yarn.lock': lockfileMock,
      '/lerna.json': JSON.stringify({
        packages: ['packages/*'],
      }),
      '/packages/a/package.json': JSON.stringify({
        name: 'a',
        dependencies: {
          '@backstage/core': '^1.0.5',
        },
      }),
      '/packages/b/package.json': JSON.stringify({
        name: 'b',
        dependencies: {
          '@backstage/core': '^1.0.3',
          '@backstage/theme': '^1.0.0',
        },
      }),
    });

    paths.targetDir = '/';
    jest
      .spyOn(paths, 'resolveTargetRoot')
      .mockImplementation((...paths) => resolvePath('/', ...paths));
    jest.spyOn(runObj, 'runPlain').mockImplementation(async (...[, , , name]) =>
      JSON.stringify({
        type: 'inspect',
        data: {
          name: name,
          'dist-tags': {
            latest: REGISTRY_VERSIONS[name],
          },
        },
      }),
    );
    jest.spyOn(runObj, 'run').mockResolvedValue(undefined);

    const { log: logs } = await withLogCollector(['log'], async () => {
      await bump();
    });
    expect(logs.filter(Boolean)).toEqual([
      'Checking for updates of @backstage/theme',
      'Checking for updates of @backstage/core',
      'Checking for updates of @backstage/core-api',
      'Some packages are outdated, updating',
      'Removing lockfile entry for @backstage/core@^1.0.3 to bump to 1.0.6',
      'Removing lockfile entry for @backstage/core-api@^1.0.6 to bump to 1.0.7',
      'Removing lockfile entry for @backstage/core-api@^1.0.3 to bump to 1.0.7',
      'Bumping @backstage/theme in b to ^2.0.0',
      "Running 'yarn install' to install new versions",
    ]);

    expect(runObj.runPlain).toHaveBeenCalledTimes(3);
    expect(runObj.runPlain).toHaveBeenCalledWith(
      'yarn',
      'info',
      '--json',
      '@backstage/core',
    );
    expect(runObj.runPlain).toHaveBeenCalledWith(
      'yarn',
      'info',
      '--json',
      '@backstage/theme',
    );

    expect(runObj.run).toHaveBeenCalledTimes(1);
    expect(runObj.run).toHaveBeenCalledWith('yarn', ['install']);

    const lockfileContents = await fs.readFile('/yarn.lock', 'utf8');
    expect(lockfileContents).toBe(lockfileMockResult);

    const packageA = await fs.readJson('/packages/a/package.json');
    expect(packageA).toEqual({
      name: 'a',
      dependencies: {
        '@backstage/core': '^1.0.5', // not bumped since new version is within range
      },
    });
    const packageB = await fs.readJson('/packages/b/package.json');
    expect(packageB).toEqual({
      name: 'b',
      dependencies: {
        '@backstage/core': '^1.0.3', // not bumped
        '@backstage/theme': '^2.0.0', // bumped since newer
      },
    });
  });
});
