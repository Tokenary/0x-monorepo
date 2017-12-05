#!/usr/bin/env node

import chalk from 'chalk';
import * as fs from 'fs';
import {sync as globSync} from 'glob';
import * as Handlebars from 'handlebars';
import * as _ from 'lodash';
import * as mkdirp from 'mkdirp';
import * as yargs from 'yargs';

import toSnakeCase = require('to-snake-case');
import * as Web3 from 'web3';

import {ParamKind} from './types';
import {utils} from './utils';

const ABI_TYPE_METHOD = 'function';

const args = yargs
    .option('abiGlob', {
        describe: 'Glob pattern to search for ABI JSON files',
        type: 'string',
        demand: true,
    })
    .option('templates', {
        describe: 'Folder where to search for templates',
        type: 'string',
        demand: true,
    })
    .option('output', {
        describe: 'Folder where to put the output files',
        type: 'string',
        demand: true,
    })
    .argv;

function writeOutputFile(name: string, renderedTsCode: string): void {
    const fileName = toSnakeCase(name);
    const filePath = `${args.output}/${fileName}.ts`;
    fs.writeFileSync(filePath, renderedTsCode);
    utils.log(`Created: ${chalk.bold(filePath)}`);
}

Handlebars.registerHelper('parameterType', utils.solTypeToTsType.bind(utils, ParamKind.Input));
Handlebars.registerHelper('returnType', utils.solTypeToTsType.bind(utils, ParamKind.Output));
const partialTemplateFileNames = globSync(`${args.templates}/partials/**/*.mustache`);
for (const partialTemplateFileName of partialTemplateFileNames) {
    const namedContent = utils.getNamedContent(partialTemplateFileName);
    Handlebars.registerPartial(namedContent.name, namedContent.content);
}

const mainTemplate = utils.getNamedContent(`${args.templates}/contract.mustache`);
const template = Handlebars.compile(mainTemplate.content);
const abiFileNames = globSync(args.abiGlob);
if (_.isEmpty(abiFileNames)) {
    utils.log(`${chalk.red(`No ABI files found.`)}`);
    utils.log(`Please make sure you've passed the correct folder name and that the files have
               ${chalk.bold('*.json')} extensions`);
    process.exit(1);
} else {
    utils.log(`Found ${chalk.green(`${abiFileNames.length}`)} ${chalk.bold('ABI')} files`);
    mkdirp.sync(args.output);
}
for (const abiFileName of abiFileNames) {
    const namedContent = utils.getNamedContent(abiFileName);
    utils.log(`Processing: ${chalk.bold(namedContent.name)}...`);
    const parsedContent = JSON.parse(namedContent.content);
    const ABI = _.isArray(parsedContent) ?
                parsedContent : // ABI file
                parsedContent.abi; // Truffle contracts file
    const methodAbis = ABI.filter((abi: Web3.AbiDefinition) => abi.type === ABI_TYPE_METHOD) as Web3.MethodAbi[];
    _.map(methodAbis, methodAbi => {
        _.map(methodAbi.inputs, input => {
            if (_.isEmpty(input.name)) {
                // Auto-generated getters don't have parameter names
                input.name = 'index';
            }
        });
        // This will make temlates simpler
        (methodAbi.outputs as any).singleReturnValue = methodAbi.outputs.length === 1;
    });
    const templateData = {
        contractName: namedContent.name,
        methodAbis,
    };
    const renderedTsCode = template(templateData);
    writeOutputFile(namedContent.name, renderedTsCode);
}
