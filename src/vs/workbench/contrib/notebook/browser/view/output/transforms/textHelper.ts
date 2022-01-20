/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { Codicon } from 'vs/base/common/codicons';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { DefaultEndOfLine, EndOfLinePreference, ITextBuffer } from 'vs/editor/common/model';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { handleANSIOutput } from 'vs/workbench/contrib/debug/browser/debugANSIHandling';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { IGenericCellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellUri } from 'vs/workbench/contrib/notebook/common/notebookCommon';

const SIZE_LIMIT = 65535;

function generateViewMoreElement(notebookUri: URI, cellViewModel: IGenericCellViewModel, outputId: string, disposables: DisposableStore, openerService: IOpenerService): HTMLElement {
	const md: IMarkdownString = {
		value: `Output exceeds the [size limit](command:workbench.action.openSettings?["notebook.output.textLineLimit"]). Open the full output data[ in a text editor](command:workbench.action.openLargeOutput?${outputId})`,
		isTrusted: true,
		supportThemeIcons: true
	};

	const rendered = disposables.add(renderMarkdown(md, {
		actionHandler: {
			callback: (content) => {
				const ret = /command\:workbench\.action\.openLargeOutput\?(.*)/.exec(content);
				if (ret && ret.length === 2) {
					const outputId = ret[1];
					openerService.open(CellUri.generateCellOutputUri(notebookUri, cellViewModel.handle, outputId));
				}

				if (content.startsWith('command:workbench.action.openSettings')) {
					openerService.open(content, { allowCommands: true });
				}

				return;
			},
			disposables: disposables
		}
	}));

	rendered.element.classList.add('output-show-more');
	return rendered.element;
}

export function truncatedArrayOfString(notebookUri: URI, cellViewModel: IGenericCellViewModel, outputId: string, linesLimit: number, container: HTMLElement, outputs: string[], disposables: DisposableStore, linkDetector: LinkDetector, openerService: IOpenerService, themeService: IThemeService) {
	const fullLen = outputs.reduce((p, c) => {
		return p + c.length;
	}, 0);

	let buffer: ITextBuffer | undefined = undefined;

	if (fullLen > SIZE_LIMIT) {
		// it's too large and we should find min(maxSizeLimit, maxLineLimit)
		const bufferBuilder = new PieceTreeTextBufferBuilder();
		outputs.forEach(output => bufferBuilder.acceptChunk(output));
		const factory = bufferBuilder.finish();
		buffer = factory.create(DefaultEndOfLine.LF).textBuffer;
		const sizeBufferLimitPosition = buffer.getPositionAt(SIZE_LIMIT);
		if (sizeBufferLimitPosition.lineNumber < linesLimit) {
			const truncatedText = buffer.getValueInRange(new Range(1, 1, sizeBufferLimitPosition.lineNumber, sizeBufferLimitPosition.column), EndOfLinePreference.TextDefined);
			container.appendChild(handleANSIOutput(truncatedText, linkDetector, themeService, undefined));
			// view more ...
			container.appendChild(generateViewMoreElement(notebookUri, cellViewModel, outputId, disposables, openerService));
			return;
		}
	}

	if (!buffer) {
		const bufferBuilder = new PieceTreeTextBufferBuilder();
		outputs.forEach(output => bufferBuilder.acceptChunk(output));
		const factory = bufferBuilder.finish();
		buffer = factory.create(DefaultEndOfLine.LF).textBuffer;
	}

	if (buffer.getLineCount() < linesLimit) {
		const lineCount = buffer.getLineCount();
		const fullRange = new Range(1, 1, lineCount, Math.max(1, buffer.getLineLastNonWhitespaceColumn(lineCount)));
		container.appendChild(handleANSIOutput(buffer.getValueInRange(fullRange, EndOfLinePreference.TextDefined), linkDetector, themeService, undefined));
		return;
	}

	container.appendChild(generateViewMoreElement(notebookUri, cellViewModel, outputId, disposables, openerService));

	const div = DOM.$('div');
	container.appendChild(div);
	div.appendChild(handleANSIOutput(buffer.getValueInRange(new Range(1, 1, linesLimit - 5, buffer.getLineLastNonWhitespaceColumn(linesLimit - 5)), EndOfLinePreference.TextDefined), linkDetector, themeService, undefined));

	// view more ...
	DOM.append(container, DOM.$('span' + Codicon.toolBarMore.cssSelector));

	const lineCount = buffer.getLineCount();
	const div2 = DOM.$('div');
	container.appendChild(div2);
	div2.appendChild(handleANSIOutput(buffer.getValueInRange(new Range(lineCount - 5, 1, lineCount, buffer.getLineLastNonWhitespaceColumn(lineCount)), EndOfLinePreference.TextDefined), linkDetector, themeService, undefined));
}
