import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import {
  Tree,
  addProjectConfiguration,
  writeJson,
  joinPathFragments,
  stripIndents,
  readJson,
  updateJson,
  ProjectGraph,
  workspaceRoot,
} from '@nrwl/devkit';
import * as devkit from '@nrwl/devkit';
import * as childProcess from 'child_process';

import generator from './index';
import { PackageJson, TsConfig } from '../../types';

const blankGraphMock = {
  dependencies: {},
  nodes: {},
  externalNodes: {},
};
let graphMock: ProjectGraph;
const codeownersPath = joinPathFragments('.github', 'CODEOWNERS');

jest.mock('@nrwl/devkit', () => {
  async function createProjectGraphAsyncMock(): Promise<ProjectGraph> {
    return graphMock;
  }

  return {
    ...jest.requireActual('@nrwl/devkit'),
    createProjectGraphAsync: createProjectGraphAsyncMock,
  };
});

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

let execSyncSpy: jest.SpyInstance;
let installPackagesTaskSpy: jest.SpyInstance;

describe('prepare-initial-release generator', () => {
  let tree: Tree;

  beforeEach(() => {
    execSyncSpy = jest.spyOn(childProcess, 'execSync').mockImplementation(
      // @ts-expect-error - no need to mock whole execSync API
      noop,
    );
    installPackagesTaskSpy = jest.spyOn(devkit, 'installPackagesTask').mockImplementation(noop);
    graphMock = {
      ...blankGraphMock,
    };
    tree = createTreeWithEmptyWorkspace();
    tree.write(codeownersPath, `@proj/foo @org/all`);
    writeJson<TsConfig>(tree, 'tsconfig.base.v8.json', { compilerOptions: { paths: {} } });
    writeJson<TsConfig>(tree, 'tsconfig.base.v0.json', { compilerOptions: { paths: {} } });
    writeJson<TsConfig>(tree, 'tsconfig.base.all.json', { compilerOptions: { paths: {} } });
  });

  it(`should throw error if executed on invalid project`, async () => {
    createProject(tree, 'react-one-stable', {
      root: 'packages/react-one-stable',
      pkgJson: {
        version: '9.0.0-alpha.0',
      },
    });

    await expect(generator(tree, { project: '@proj/react-one-stable', phase: 'stable' })).rejects.toMatchInlineSnapshot(
      `[Error: @proj/react-one-stable is already prepared for stable release. Please trigger RELEASE pipeline.]`,
    );

    updateJson<PackageJson>(tree, 'packages/react-one-stable/package.json', json => {
      json.version = '9.0.0';
      return json;
    });

    await expect(generator(tree, { project: '@proj/react-one-stable', phase: 'stable' })).rejects.toMatchInlineSnapshot(
      `[Error: @proj/react-one-stable is already released as stable.]`,
    );
  });

  describe(`--phase`, () => {
    describe(`preview`, () => {
      it(`should prepare preview package for initial release`, async () => {
        const utils = {
          project: createProject(tree, 'react-one-preview', {
            root: 'packages/react-one-preview',
            pkgJson: {
              version: '0.0.0',
              private: true,
            },
            renameRoot: false,
          }),
          docsite: createProject(tree, 'public-docsite-v9', {
            root: 'apps/public-docsite-v9',
            pkgJson: { version: '9.0.123', private: true },
            renameRoot: false,
          }),
        };

        const sideEffects = await generator(tree, { project: '@proj/react-one-preview', phase: 'preview' });

        expect(utils.project.pkgJson()).toMatchInlineSnapshot(`
          Object {
            "name": "@proj/react-one-preview",
            "version": "0.0.0",
          }
        `);

        expect(utils.docsite.pkgJson().dependencies).toEqual(
          expect.objectContaining({
            '@proj/react-one-preview': '*',
          }),
        );

        sideEffects();

        expect(execSyncSpy.mock.calls.flat()).toMatchInlineSnapshot(`
          Array [
            "yarn change --message 'feat: release preview package' --type minor --package @proj/react-one-preview",
            Object {
              "cwd": "${workspaceRoot}",
              "stdio": "inherit",
            },
          ]
        `);
      });
    });

    describe(`stable`, () => {
      const projectName = '@proj/react-one-preview';
      type Utils = ReturnType<typeof createProject>;
      const utils = { project: {} as Utils, suite: {} as Utils, docsite: {} as Utils, vrTest: {} as Utils };

      beforeEach(() => {
        utils.project = createProject(tree, 'react-one-preview', {
          root: 'packages/react-one-preview',
          pkgJson: {
            version: '0.12.33',
          },
          files: [
            {
              filePath: 'packages/react-one-preview/src/index.ts',
              content: stripIndents`
                export {One} from './one';
                export type {OneType} from './one';

                export {Two} from './two';
                export type {TwoType} from './two';
          `,
            },
            {
              filePath: 'packages/react-one-preview/stories/One.stories.tsx',
              content: stripIndents`
            import { One } from '@proj/react-one-preview';

            export const App = () => { return <One/> };
          `,
            },
          ],
        });
        utils.suite = createProject(tree, 'react-components', {
          root: 'packages/react-components/react-components',
          pkgJson: { version: '9.0.1' },
        });
        utils.docsite = createProject(tree, 'public-docsite-v9', {
          root: 'apps/public-docsite-v9',
          pkgJson: { version: '9.0.123', private: true },
          files: [
            {
              filePath: 'apps/public-docsite-v9/src/example.stories.tsx',
              content: stripIndents`
             import { One } from '${projectName}';
             import * as suite from '@proj/react-components';

             export const Example = () => { return <suite.Root><One/></suite.Root>; }
            `,
            },
          ],
        });
        utils.vrTest = createProject(tree, 'vr-tests-react-components', {
          root: 'apps/vr-tests-react-components',
          pkgJson: { version: '9.0.77', private: true },
          files: [
            {
              filePath: 'apps/vr-tests-react-components/src/stories/One.stories.tsx',
              content: stripIndents`
             import { One } from '${projectName}';
             import * as suite from '@proj/react-components';

             export const VrTest = () => { return <suite.Root><One/></suite.Root>; }
            `,
            },
          ],
        });
      });

      it(`should prepare preview package for stable release`, async () => {
        const sideEffects = await generator(tree, { project: projectName, phase: 'stable' });

        expect(utils.project.pkgJson()).toMatchInlineSnapshot(`
          Object {
            "name": "@proj/react-one",
            "version": "9.0.0-alpha.0",
          }
        `);
        expect(utils.project.projectJson()).toEqual(
          expect.objectContaining({
            name: '@proj/react-one',
            sourceRoot: 'packages/react-one/src',
          }),
        );
        expect(utils.project.jest()).toEqual(expect.stringContaining(`displayName: 'react-one'`));
        expect(utils.project.md.readme()).toMatchInlineSnapshot(`
          "# @proj/react-one

          **React Tags components for [Fluent UI React](https://react.fluentui.dev/)**

          These are not production-ready components and **should never be used in product**. This space is useful for testing new components whose APIs might change before final release.
          "
        `);
        expect(utils.project.md.api()).toMatchInlineSnapshot(`
          "## API Report File for \\"@proj/react-one\\"

          > Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).
          "
        `);
        expect(tree.read('packages/react-one/stories/One.stories.tsx', 'utf-8')).toMatchInlineSnapshot(`
          "import { One } from '@proj/react-one-preview';

          export const App = () => {
            return <One />;
          };
          "
        `);

        expect(tree.children('packages/react-one-preview')).toEqual([]);

        expect(utils.project.global.codeowners()).toEqual(
          expect.stringContaining('packages/react-one @org/universe @johnwick'),
        );
        expect(utils.project.global.tsBase().compilerOptions.paths).toEqual(
          expect.objectContaining({
            '@proj/react-one': ['packages/react-one/src/index.ts'],
          }),
        );
        expect(utils.project.global.tsBaseAll().compilerOptions.paths).toEqual(
          expect.objectContaining({
            '@proj/react-one': ['packages/react-one/src/index.ts'],
          }),
        );

        // project updates

        expect(utils.docsite.pkgJson().dependencies).not.toEqual(
          expect.objectContaining({ '@proj/react-one-preview': '*' }),
        );
        expect(tree.read('apps/public-docsite-v9/src/example.stories.tsx', 'utf-8')).toEqual(
          expect.stringContaining(stripIndents`
            import { One } from '@proj/react-components';
            import * as suite from '@proj/react-components';
        `),
        );

        const vrTestDeps = utils.vrTest.pkgJson().dependencies ?? {};
        expect(vrTestDeps).toEqual(expect.objectContaining({ '@proj/react-one': '*' }));
        expect(vrTestDeps[projectName]).toEqual(undefined);
        expect(tree.read('apps/vr-tests-react-components/src/stories/One.stories.tsx', 'utf-8')).toEqual(
          expect.stringContaining(stripIndents`
            import { One } from '@proj/react-one';
            import * as suite from '@proj/react-components';
        `),
        );

        expect(utils.suite.pkgJson().dependencies).toEqual(
          expect.objectContaining({ '@proj/react-one': '9.0.0-alpha.0' }),
        );
        expect(tree.read('packages/react-components/react-components/src/index.ts', 'utf-8')).toEqual(
          expect.stringContaining(stripIndents`
            export { One, Two } from '@proj/react-one';
            export type { OneType, TwoType } from '@proj/react-one';
        `),
        );

        sideEffects();

        expect(execSyncSpy.mock.calls.flat()).toMatchInlineSnapshot(`
          Array [
            "yarn change --message 'feat: release stable' --type minor --package @proj/react-one",
            Object {
              "cwd": "${workspaceRoot}",
              "stdio": "inherit",
            },
            "yarn change --message 'feat: add @proj/react-one to suite' --type minor --package @proj/react-components",
            Object {
              "cwd": "${workspaceRoot}",
              "stdio": "inherit",
            },
            "yarn lage generate-api --to @proj/react-components",
            Object {
              "cwd": "${workspaceRoot}",
              "stdio": "inherit",
            },
          ]
        `);
        expect(installPackagesTaskSpy).toHaveBeenCalled();
      });

      it(`should update also other packages besides known ones if preview was used there`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        const utils = createProject(tree, 'react-another-app', {
          root: 'apps/react-another-app',
          pkgJson: { version: '9.2.0', dependencies: { '@proj/react-one-preview': '*' } },
          files: [
            {
              filePath: 'apps/react-another-app/src/index.ts',
              content: stripIndents`
          import * as React from 'react';
          import { One } from '@proj/react-one-preview';
          `,
            },
          ],
        });

        await generator(tree, { project: projectName, phase: 'stable' });

        const dependencies = utils.pkgJson().dependencies ?? {};
        expect(dependencies[projectName]).toEqual(undefined);
        expect(dependencies).toEqual(
          expect.objectContaining({
            '@proj/react-components': '*',
          }),
        );

        expect(tree.read('apps/react-another-app/src/index.ts', 'utf-8')).toEqual(
          expect.stringContaining(stripIndents`
            import { One } from '@proj/react-components';
        `),
        );
      });
    });
  });
});

function createProject(
  tree: Tree,
  projectName: string,
  options: {
    root: string;
    pkgJson: Partial<PackageJson>;
    files?: Array<{ filePath: string; content: string }>;
    renameRoot?: boolean;
  },
) {
  const projectType = options.root.startsWith('apps/') ? 'application' : 'library';
  const npmName = `@proj/${projectName}`;
  const pkgJsonPath = joinPathFragments(options.root, 'package.json');
  const sourceRoot = joinPathFragments(options.root, 'src');
  const indexFile = joinPathFragments(sourceRoot, 'index.ts');
  const jestPath = joinPathFragments(options.root, 'jest.config.js');
  const readmePath = joinPathFragments(options.root, 'README.md');
  const apiMdPath = joinPathFragments(options.root, `etc/${projectName}.api.md`);
  const tsConfigBaseAllPath = 'tsconfig.base.all.json';
  const tsConfigBasePath = 'tsconfig.base.json';

  writeJson(tree, pkgJsonPath, {
    ...options.pkgJson,
    name: npmName,
  });

  addProjectConfiguration(tree, npmName, { root: options.root, sourceRoot, tags: ['vNext'] });

  tree.write(
    indexFile,
    stripIndents`
    export {};
  `,
  );

  tree.write(
    readmePath,
    stripIndents`
  # ${npmName}

**React Tags components for [Fluent UI React](https://react.fluentui.dev/)**

These are not production-ready components and **should never be used in product**. This space is useful for testing new components whose APIs might change before final release.

  `,
  );
  tree.write(
    apiMdPath,
    stripIndents`
  ## API Report File for "${npmName}"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).
  `,
  );
  tree.write(
    jestPath,
    stripIndents`
    module.exports = {
      displayName: '${projectName}',
    };
  `,
  );

  const currentCodeowners = tree.read(codeownersPath, 'utf-8');
  const updatedCodeowners = currentCodeowners + `${options.root} @org/universe @johnwick\n`;
  tree.write(codeownersPath, updatedCodeowners);
  updateJson<TsConfig>(tree, tsConfigBasePath, json => {
    json.compilerOptions.paths![npmName] = [indexFile];
    return json;
  });
  updateJson<TsConfig>(tree, tsConfigBaseAllPath, json => {
    json.compilerOptions.paths![npmName] = [indexFile];
    return json;
  });

  const depKeys = [...Object.keys(options.pkgJson.dependencies ?? {})];

  graphMock.dependencies[npmName] = depKeys.map(value => {
    return { source: npmName, target: value, type: 'static' };
  });
  graphMock.nodes[npmName] = {
    name: npmName,
    type: projectType === 'library' ? 'lib' : 'app',
    data: { name: npmName, root: npmName, files: [] },
  };

  if (options.files) {
    options.files.forEach(fileEntry => {
      tree.write(fileEntry.filePath, fileEntry.content);
    });
  }

  const newRoot = options.renameRoot === false ? options.root : options.root.replace('-preview', '');

  return {
    pkgJson: () => {
      return readJson<PackageJson>(tree, joinPathFragments(newRoot, 'package.json'));
    },
    projectJson: () => {
      return readJson(tree, joinPathFragments(newRoot, 'project.json'));
    },
    jest: () => {
      return tree.read(joinPathFragments(newRoot, 'jest.config.js'), 'utf-8');
    },
    md: {
      readme: () => tree.read(joinPathFragments(newRoot, 'README.md'), 'utf-8'),
      api: () => tree.read(joinPathFragments(newRoot, `etc/${projectName.replace('-preview', '')}.api.md`), 'utf-8'),
    },
    global: {
      tsBase: () => readJson<TsConfig>(tree, tsConfigBasePath),
      tsBaseAll: () => readJson<TsConfig>(tree, tsConfigBaseAllPath),
      codeowners: () => tree.read(codeownersPath, 'utf-8'),
    },
  };
}
