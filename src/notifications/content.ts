import { NewEvent } from '../db/schema.js';
import { getEmailBodyForEvent, getEmailSubjectForEvent } from '../processor.js';
import { NotificationData } from './interface.js';
import mjml2html from 'mjml';
import { minify } from 'html-minifier-terser';
import { Logger } from 'winston';
import Turndown from 'turndown';
// @ts-ignore
import turndownPluginGfm from 'turndown-plugin-gfm';

const turndown = new Turndown({
  linkStyle: 'inlined',
  bulletListMarker: '*',
  codeBlockStyle: 'fenced',
  preformattedCode: true,
  emDelimiter: '*',
  strongDelimiter: '**',
  fence: '```',
  headingStyle: 'atx',
  hr: '---',
  br: '\n',
});

/**
 * Generates notification content for all providers based on an event
 * This handles HTML, plaintext, and subject generation
 */
export async function generateNotificationContent(
  event: NewEvent,
  recipients: string[],
  logger: Logger,
): Promise<NotificationData> {
  const mjmlTemplate = await getEmailBodyForEvent(event);

  // Convert MJML to HTML
  const htmlOutput = mjml2html(mjmlTemplate, {
    keepComments: false,
    beautify: false,
    minify: false, // we'll minify ourselves in the next step
  });

  // Minify the HTML to reduce size
  const html = await minify(htmlOutput.html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
    minifyURLs: true,
    removeEmptyElements: true,
  });

  // Generate plain text version by removing HTML tags
  // This is a simple implementation - a more sophisticated version would
  // convert HTML tables and structures to plain text
  const text = turndown.turndown(html.replace(/#outlook\b[\s\S]*\}\s*$/, ''));

  // Get subject line
  const subject = await getEmailSubjectForEvent(event);

  logger.debug('Generated notification content', {
    eventType: event.eventType,
    subject,
    htmlLength: html.length,
    textLength: text.length,
  });

  return {
    event,
    html,
    subject,
    text,
    recipients,
  };
}
