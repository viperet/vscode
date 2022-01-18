/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal, IMarker, IBuffer } from 'xterm';
import { Emitter } from 'vs/base/common/event';
import { CommandTrackerAddon } from 'vs/workbench/contrib/terminal/browser/xterm/commandTrackerAddon';
import { ILogService } from 'vs/platform/log/common/log';
import { ShellIntegrationInfo, ShellIntegrationInteraction } from 'vs/workbench/contrib/terminal/browser/xterm/shellIntegrationAddon';
import { isWindows } from 'vs/base/common/platform';
import { TerminalCommand } from 'vs/workbench/contrib/terminal/browser/terminal';

interface ICurrentPartialCommand {
	marker?: IMarker;
	previousCommandMarker?: IMarker;
	promptStartY?: number;
	commandStartY?: number;
	commandStartX?: number;
	commandExecutedY?: number;
	commandExecutedMarker?: IMarker;
	commandExecutedX?: number;
	commandFinishedY?: number;
	command?: string;
}

export class CognisantCommandTrackerAddon extends CommandTrackerAddon {
	private _commands: TerminalCommand[] = [];
	private _cwds = new Map<string, number>();
	private _exitCode: number | undefined;
	private _cwd: string | undefined;
	private _currentCommand: ICurrentPartialCommand = {};
	private _initialCwd: string | undefined;

	protected _terminal: Terminal | undefined;

	private readonly _onCwdChanged = new Emitter<string>();
	readonly onCwdChanged = this._onCwdChanged.event;

	constructor(
		@ILogService private readonly _logService: ILogService
	) {
		super();
	}

	activate(terminal: Terminal): void {
		this._terminal = terminal;
	}

	handleIntegratedShellChange(event: { type: string, value: string }): void {
		if (!this._terminal) {
			return;
		}
		switch (event.type) {
			case ShellIntegrationInfo.CurrentDir: {
				if (!this._initialCwd) {
					this._initialCwd = event.value;
				}
				this._cwd = event.value;
				const freq = this._cwds.get(this._cwd) || 0;
				this._cwds.set(this._cwd, freq + 1);
				this._onCwdChanged.fire(this._cwd);
				break;
			}
			case ShellIntegrationInteraction.PromptStart:
				this._currentCommand.promptStartY = this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY;
				break;
			case ShellIntegrationInteraction.CommandStart:
				this._currentCommand.commandStartX = this._terminal.buffer.active.cursorX;
				this._currentCommand.commandStartY = this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY;
				this._currentCommand.marker = this._terminal.registerMarker(0);
				break;
			case ShellIntegrationInteraction.CommandExecuted:
				this._currentCommand.commandExecutedMarker = this._terminal.registerMarker(0);
				// TODO: Make sure this only runs on Windows backends (not frontends)
				if (!isWindows && this._currentCommand.marker && this._currentCommand.commandExecutedMarker && this._currentCommand.commandStartX) {
					this._currentCommand.command = this._terminal.buffer.active.getLine(this._currentCommand.marker.line)?.translateToString().substring(this._currentCommand.commandStartX);
					let y = this._currentCommand.marker.line + 1;
					const commandExecutedLine = this._currentCommand.commandExecutedMarker.line;
					for (; y < commandExecutedLine; y++) {
						const line = this._terminal.buffer.active.getLine(y);
						if (line) {
							this._currentCommand.command += line.translateToString(true);
						}
					}
					if (y === commandExecutedLine) {
						this._currentCommand.command += this._terminal.buffer.active.getLine(commandExecutedLine)?.translateToString(true, undefined, this._currentCommand.commandExecutedX) || '';
					}
					break;
				}
				this._currentCommand.commandExecutedY = this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY;

				// TODO: Leverage key events on Windows between CommandStart and Executed to ensure we have the correct line

				// TODO: Only do this on Windows backends
				// Check if the command line is the same as the previous command line or if the
				// start Y differs from the executed Y. This is to catch the conpty case where the
				// "rendering" of the shell integration sequences doesn't occur on the correct cell
				// due to https://github.com/microsoft/terminal/issues/11220
				if (this._currentCommand.previousCommandMarker?.line === this._currentCommand.marker?.line ||
					this._currentCommand.commandStartY === this._currentCommand.commandExecutedY) {
					this._currentCommand.marker = this._terminal?.registerMarker(0);
					this._currentCommand.commandStartX = 0;
				}

				// TODO: This does not yet work when the prompt line is wrapped
				this._currentCommand.command = this._terminal!.buffer.active.getLine(this._currentCommand.commandExecutedY)?.translateToString(true, this._currentCommand.commandStartX || 0);

				// TODO: Only do this on Windows backends
				// Something went wrong, try predict the prompt based on the shell.
				if (this._currentCommand.commandStartX === 0) {
					// TODO: Only do this on pwsh
					const promptPredictions = [
						`PS ${this._cwd}> `,
						`PS>`,
					];
					for (const promptPrediction of promptPredictions) {
						if (this._currentCommand.command?.startsWith(promptPrediction)) {
							// TODO: Consider cell vs string positioning; test CJK
							this._currentCommand.commandStartX = promptPrediction.length;
							this._currentCommand.command = this._currentCommand.command.substring(this._currentCommand.commandStartX);
							break;
						}
					}
				}
				break;
			case ShellIntegrationInteraction.CommandFinished: {
				const command = this._currentCommand.command;
				this._logService.debug('Terminal Command Finished', this._currentCommand.command, this._currentCommand);
				this._exitCode = Number.parseInt(event.value);
				if (!this._currentCommand.marker?.line || !this._terminal.buffer.active) {
					break;
				}
				if (command && !command.startsWith('\\') && command !== '') {
					const buffer = this._terminal.buffer.active;
					const newCommand = {
						command,
						timestamp: Date.now(),
						cwd: this._cwd,
						exitCode: this._exitCode,
						getOutput: () => getOutputForCommand(this._currentCommand, buffer),
						marker: this._currentCommand.marker
					};
					this._commands.push(newCommand);
				}
				this._currentCommand.previousCommandMarker?.dispose();
				this._currentCommand.previousCommandMarker = this._currentCommand.marker;
				this._currentCommand = {};
				break;
			} default:
				return;
		}
	}

	get commands(): TerminalCommand[] {
		return this._commands;
	}

	get cwds(): string[] {
		return Array.from(new Map([...this._cwds.entries()].sort((a, b) => a[1] - b[1]))).map(s => s[0]);
	}

	getCwdForLine(line: number): string {
		const reversed = [...this._commands].reverse();
		return reversed.find(c => c.marker!.line <= line - 1)?.cwd || this._initialCwd!;
	}
}

function getOutputForCommand(command: ICurrentPartialCommand, buffer: IBuffer): string | undefined {
	const startLine = command.previousCommandMarker!.line! + 1;
	const endLine = command.marker!.line!;
	let output = '';
	for (let i = startLine; i < endLine; i++) {
		output += buffer.getLine(i)?.translateToString() + '\n';
	}
	return output === '' ? undefined : output;
}
