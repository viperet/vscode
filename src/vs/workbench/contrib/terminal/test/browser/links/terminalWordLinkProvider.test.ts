/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Terminal, ILink } from 'xterm';
import { TerminalWordLinkProvider } from 'vs/workbench/contrib/terminal/browser/links/terminalWordLinkProvider';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorOptions, ITextResourceEditorInput } from 'vs/platform/editor/common/editor';
import { AbstractLogger, DEFAULT_LOG_LEVEL, ILogger, ILogService, LogLevel, LogService, NullLogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { ITerminalConfigHelper, ITerminalConfiguration } from 'vs/workbench/contrib/terminal/common/terminal';
import { TestContextService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { TerminalCapabilityStore } from 'vs/workbench/contrib/terminal/common/capabilities/terminalCapabilityStore';
import { XtermTerminal } from 'vs/workbench/contrib/terminal/browser/xterm/xtermTerminal';
import { TerminalCapability, TerminalLocation } from 'vs/platform/terminal/common/terminal';
import { CwdDetectionCapability } from 'vs/workbench/contrib/terminal/common/capabilities/cwdDetectionCapability';
import { CognisantCommandTrackerAddon } from 'vs/workbench/contrib/terminal/browser/xterm/cognisantCommandTrackerAddon';
import { TestViewDescriptorService } from 'vs/workbench/contrib/terminal/test/browser/xterm/xtermTerminal.test';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { XtermLinkMatcherHandler } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';

const defaultTerminalConfig: Partial<ITerminalConfiguration> = {
	fontFamily: 'monospace',
	fontWeight: 'normal',
	fontWeightBold: 'normal',
	gpuAcceleration: 'off',
	scrollback: 1000,
	fastScrollSensitivity: 2,
	mouseWheelScrollSensitivity: 1,
	unicodeVersion: '11',
	wordSeparators: ' ()[]{}\',"`─‘’'
};

class TestCommandTracker extends CognisantCommandTrackerAddon {
	private _currentCwd: string | undefined;
	override getCwdForLine(y: number): string {
		return this._currentCwd || '';
	}
	setCwd(cwd: string): void {
		this._currentCwd = cwd;
	}
}

class TestLogger extends AbstractLogger implements ILogger {

	public logs: string[] = [];

	constructor(logLevel: LogLevel = DEFAULT_LOG_LEVEL) {
		super();
		this.setLevel(logLevel);
	}

	trace(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Trace) {
			this.logs.push(message + JSON.stringify(args));
		}
	}

	debug(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Debug) {
			this.logs.push(message);
		}
	}

	info(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Info) {
			this.logs.push(message);
		}
	}

	warn(message: string | Error, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Warning) {
			this.logs.push(message.toString());
		}
	}

	error(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Error) {
			this.logs.push(message);
		}
	}

	critical(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Critical) {
			this.logs.push(message);
		}
	}

	override dispose(): void { }
	flush(): void { }
}

class TestXtermTerminal extends XtermTerminal {
	override get commandTracker(): TestCommandTracker { return new TestCommandTracker(new LogService(new TestLogger())); }
}

suite('Workbench - TerminalWordLinkProvider', () => {
	let instantiationService: TestInstantiationService;
	let configurationService: TestConfigurationService;
	let themeService: TestThemeService;
	let viewDescriptorService: TestViewDescriptorService;
	let xterm: TestXtermTerminal;
	let configHelper: ITerminalConfigHelper;
	let capabilities: TerminalCapabilityStore;
	let activateResult: ITerminalLinkActivationResult | undefined;

	setup(() => {
		instantiationService = new TestInstantiationService();
		configurationService = new TestConfigurationService();
		instantiationService.stub(IConfigurationService, configurationService);
		configurationService = new TestConfigurationService({
			editor: {
				fastScrollSensitivity: 2,
				mouseWheelScrollSensitivity: 1
			} as Partial<IEditorOptions>,
			terminal: {
				integrated: defaultTerminalConfig
			}
		});
		themeService = new TestThemeService();
		viewDescriptorService = new TestViewDescriptorService();
		capabilities = new TerminalCapabilityStore();
		instantiationService = new TestInstantiationService();
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IStorageService, new TestStorageService());
		instantiationService.stub(IThemeService, themeService);
		instantiationService.stub(IViewDescriptorService, viewDescriptorService);
		instantiationService.stub(IWorkspaceContextService, new TestContextService());

		// Allow intercepting link activations
		activateResult = undefined;
		instantiationService.stub(IQuickInputService, {
			quickAccess: {
				show(link: string) {
					activateResult = { link, source: 'quickpick' };
				}
			}
		} as Partial<IQuickInputService>);
		instantiationService.stub(IEditorService, {
			async openEditor(editor: ITextResourceEditorInput): Promise<any> {
				activateResult = {
					source: 'editor',
					link: editor.resource?.toString()
				};
			}
		} as Partial<IEditorService>);

		configHelper = instantiationService.createInstance(TerminalConfigHelper);
		configHelper = instantiationService.createInstance(TerminalConfigHelper);
		xterm = instantiationService.createInstance(TestXtermTerminal, Terminal, configHelper, 80, 30, TerminalLocation.Panel);
	});

	async function assertLink(text: string, expected: { text: string, range: [number, number][], linkActivationResult?: ITerminalLinkActivationResult }[], registerCwdDetectionCapability?: boolean) {
		xterm?.dispose();
		xterm = instantiationService.createInstance(TestXtermTerminal, Terminal, configHelper, 80, 30, TerminalLocation.Panel);
		if (registerCwdDetectionCapability) {
			capabilities = new TerminalCapabilityStore();
			capabilities.add(TerminalCapability.CwdDetection, new CwdDetectionCapability());
		}
		// We don't want to cancel the event or anything from the tests so just pass in a wrapped
		// link handler that does nothing.

		const testWrappedLinkHandler = (handler: (event: MouseEvent | undefined, link: string) => void): XtermLinkMatcherHandler => {
			return async (event: MouseEvent | undefined, link: string) => {
				handler(event, link);
			};
		};
		const provider: TerminalWordLinkProvider = instantiationService.createInstance(TerminalWordLinkProvider,
			xterm,
			capabilities,
			testWrappedLinkHandler,
			() => { }
		);

		// Write the text and wait for the parser to finish
		await new Promise<void>(r => xterm.raw.write(text, r));

		// Ensure all links are provided
		const links = (await new Promise<ILink[] | undefined>(r => provider.provideLinks(1, r)))!;
		const actualLinks = await Promise.all(links.map(async e => {
			if (registerCwdDetectionCapability) {
				// HACK: Xterm.js works on sync links only but we use async links
				await e.activate(new MouseEvent('click'), e.text);
			}
			return {
				text: e.text,
				range: e.range,
				activateText: registerCwdDetectionCapability ? activateResult : undefined
			};
		}));

		const expectedVerbose = expected.map(e => ({
			text: e.text,
			range: {
				start: { x: e.range[0][0], y: e.range[0][1] },
				end: { x: e.range[1][0], y: e.range[1][1] },
			},
			activateText: e.linkActivationResult
		}));
		assert.deepStrictEqual(actualLinks, expectedVerbose);
		assert.strictEqual(links.length, expected.length);
	}

	test('should link words as defined by wordSeparators', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ()[]' } });
		await assertLink('foo', [{ range: [[1, 1], [3, 1]], text: 'foo' }]);
		await assertLink('foo', [{ range: [[1, 1], [3, 1]], text: 'foo' }]);
		await assertLink(' foo ', [{ range: [[2, 1], [4, 1]], text: 'foo' }]);
		await assertLink('(foo)', [{ range: [[2, 1], [4, 1]], text: 'foo' }]);
		await assertLink('[foo]', [{ range: [[2, 1], [4, 1]], text: 'foo' }]);
		await assertLink('{foo}', [{ range: [[1, 1], [5, 1]], text: '{foo}' }]);

		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('foo', [{ range: [[1, 1], [3, 1]], text: 'foo' }]);
		await assertLink(' foo ', [{ range: [[2, 1], [4, 1]], text: 'foo' }]);
		await assertLink('(foo)', [{ range: [[1, 1], [5, 1]], text: '(foo)' }]);
		await assertLink('[foo]', [{ range: [[1, 1], [5, 1]], text: '[foo]' }]);
		await assertLink('{foo}', [{ range: [[1, 1], [5, 1]], text: '{foo}' }]);

		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' []' } });
		await assertLink('aabbccdd.txt ', [{ range: [[1, 1], [12, 1]], text: 'aabbccdd.txt' }]);
		await assertLink(' aabbccdd.txt ', [{ range: [[2, 1], [13, 1]], text: 'aabbccdd.txt' }]);
		await assertLink(' [aabbccdd.txt] ', [{ range: [[3, 1], [14, 1]], text: 'aabbccdd.txt' }]);
	});

	// These are failing - the link's start x is 1 px too far to the right bc it starts
	// with a wide character, which the terminalLinkHelper currently doesn't account for
	test.skip('should support wide characters', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' []' } });
		await assertLink('我是学生.txt ', [{ range: [[1, 1], [12, 1]], text: '我是学生.txt' }]);
		await assertLink(' 我是学生.txt ', [{ range: [[2, 1], [13, 1]], text: '我是学生.txt' }]);
		await assertLink(' [我是学生.txt] ', [{ range: [[3, 1], [14, 1]], text: '我是学生.txt' }]);
	});

	test('should support multiple link results', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('foo bar', [
			{ range: [[1, 1], [3, 1]], text: 'foo' },
			{ range: [[5, 1], [7, 1]], text: 'bar' }
		]);
	});

	test('should remove trailing colon in the link results', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('foo:5:6: bar:0:32:', [
			{ range: [[1, 1], [7, 1]], text: 'foo:5:6' },
			{ range: [[10, 1], [17, 1]], text: 'bar:0:32' }
		]);
	});

	test('should support wrapping', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('fsdjfsdkfjslkdfjskdfjsldkfjsdlkfjslkdjfskldjflskdfjskldjflskdfjsdklfjsdklfjsldkfjsdlkfjsdlkfjsdlkfjsldkfjslkdfjsdlkfjsldkfjsdlkfjskdfjsldkfjsdlkfjslkdfjsdlkfjsldkfjsldkfjsldkfjslkdfjsdlkfjslkdfjsdklfsd', [
			{ range: [[1, 1], [41, 3]], text: 'fsdjfsdkfjslkdfjskdfjsldkfjsdlkfjslkdjfskldjflskdfjskldjflskdfjsdklfjsdklfjsldkfjsdlkfjsdlkfjsdlkfjsldkfjslkdfjsdlkfjsldkfjsdlkfjskdfjsldkfjsdlkfjslkdfjsdlkfjsldkfjsldkfjsldkfjslkdfjsdlkfjslkdfjsdklfsd' },
		]);
	});
	test('should support wrapping with multiple links', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('fsdjfsdkfjslkdfjskdfjsldkfj sdlkfjslkdjfskldjflskdfjskldjflskdfj sdklfjsdklfjsldkfjsdlkfjsdlkfjsdlkfjsldkfjslkdfjsdlkfjsldkfjsdlkfjskdfjsldkfjsdlkfjslkdfjsdlkfjsldkfjsldkfjsldkfjslkdfjsdlkfjslkdfjsdklfsd', [
			{ range: [[1, 1], [27, 1]], text: 'fsdjfsdkfjslkdfjskdfjsldkfj' },
			{ range: [[29, 1], [64, 1]], text: 'sdlkfjslkdjfskldjflskdfjskldjflskdfj' },
			{ range: [[66, 1], [43, 3]], text: 'sdklfjsdklfjsldkfjsdlkfjsdlkfjsdlkfjsldkfjslkdfjsdlkfjsldkfjsdlkfjskdfjsldkfjsdlkfjslkdfjsdlkfjsldkfjsldkfjsldkfjslkdfjsdlkfjslkdfjsdklfsd' }
		]);
	});
	test('does not return any links for empty text', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('', []);
	});
	test('should support file scheme links', async () => {
		await configurationService.setUserConfiguration('terminal', { integrated: { wordSeparators: ' ' } });
		await assertLink('file:///C:/users/test/file.txt ', [{ range: [[1, 1], [30, 1]], text: 'file:///C:/users/test/file.txt' }]);
		await assertLink('file:///C:/users/test/file.txt:1:10 ', [{ range: [[1, 1], [35, 1]], text: 'file:///C:/users/test/file.txt:1:10' }]);
	});
	test.skip('should add cwd to link', async () => {
		xterm.commandTracker.setCwd('/Users/home/folder');
		await assertLink('file.txt ', [{ range: [[1, 1], [8, 1]], text: 'file.txt', linkActivationResult: { link: '/Users/home/folder/file.txt', source: 'editor' } }], true);
	});
});

interface ITerminalLinkActivationResult {
	source: 'editor' | 'quickpick',
	link: string
}
