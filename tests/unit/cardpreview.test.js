import { describe, it, expect } from 'vitest';
import { makeDocx, makeXlsx, makeZip } from '../../src/utils/exporters.js';
import { docxParagraphs, xlsxGrid, pptxFirstSlide } from '../../src/search/extract.js';

describe('first-page content for grid previews', () => {
  it('reads paragraphs from a .docx', async () => {
    const paras = await docxParagraphs(makeDocx('Network Proposal\nTo: IT\n\nPurpose of the proposal'));
    expect(paras.map((p) => p.text)).toEqual(['Network Proposal', 'To: IT', 'Purpose of the proposal']);
  });

  it('treats styled and all-bold short paragraphs in a .docx as headings', async () => {
    const doc = '<w:document><w:body>'
      + '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Proposal</w:t></w:r></w:p>'
      + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>I. Purpose</w:t></w:r></w:p>'
      + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>From:</w:t></w:r><w:r><w:t> IT Department</w:t></w:r></w:p>'
      + '</w:body></w:document>';
    const paras = await docxParagraphs(makeZip([{ path: 'word/document.xml', data: doc }]));
    expect(paras).toEqual([{ text: 'Proposal', heading: true }, { text: 'I. Purpose', heading: true }, { text: 'From: IT Department', heading: false }]);
  });

  it('reads the top-left cells of an .xlsx (inline strings and numbers)', async () => {
    const rows = await xlsxGrid(makeXlsx([['Item', 'Qty'], ['Gloves', '40'], ['Masks', '125']]));
    expect(rows).toEqual([['Item', 'Qty'], ['Gloves', '40'], ['Masks', '125']]);
  });

  it('reads shared strings and keeps empty cells in place', async () => {
    const blob = makeZip([
      { path: 'xl/sharedStrings.xml', data: '<sst><si><t>Name</t></si><si><t>Price &amp; tax</t></si><si><r><t>Bed</t></r><r><t> frame</t></r></si></sst>' },
      { path: 'xl/worksheets/sheet1.xml', data: '<worksheet><cols><col min="1" max="2"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>99.5</v></c></row></sheetData></worksheet>' },
    ]);
    expect(await xlsxGrid(blob)).toEqual([['Name', '', 'Price & tax'], ['', '', ''], ['Bed frame', '', '99.5']]);
  });

  it('limits rows and columns', async () => {
    const big = Array.from({ length: 50 }, (_, r) => Array.from({ length: 20 }, (__, c) => `${r}-${c}`));
    const rows = await xlsxGrid(makeXlsx(big), 10, 5);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveLength(5);
  });

  it('reads the first slide of a .pptx', async () => {
    const blob = makeZip([
      { path: 'ppt/slides/slide1.xml', data: '<p:sld><a:p><a:r><a:t>Quarterly Review</a:t></a:r></a:p><a:p><a:r><a:t>Revenue up 14%</a:t></a:r></a:p></p:sld>' },
      { path: 'ppt/slides/slide2.xml', data: '<p:sld><a:p><a:r><a:t>Agenda</a:t></a:r></a:p></p:sld>' },
    ]);
    expect(await pptxFirstSlide(blob)).toEqual({ title: 'Quarterly Review', body: 'Revenue up 14%' });
  });
});

describe('full previews of uploaded Office files', () => {
  it('reads every slide of a .pptx in order (slide10 after slide9)', async () => {
    const { pptxSlides } = await import('../../src/search/extract.js');
    const slide = (t) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>body ${t}</a:t></a:r></a:p></p:sld>`;
    const blob = makeZip(Array.from({ length: 10 }, (_, i) => ({ path: `ppt/slides/slide${i + 1}.xml`, data: slide(`S${i + 1}`) })));
    const slides = await pptxSlides(blob);
    expect(slides.map((s) => s.title)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
    expect(slides[0].body).toBe('body S1');
  });
  it('decodes numeric and hex character references', async () => {
    const doc = '<w:document><w:body><w:p><w:r><w:t>Caf&#233; &#x2013; d&#xE9;j&#224; vu &amp; more</w:t></w:r></w:p></w:body></w:document>';
    const paras = await docxParagraphs(makeZip([{ path: 'word/document.xml', data: doc }]));
    expect(paras[0].text).toBe('Café – déjà vu & more');
  });
});

describe('PDF error messages', () => {
  it('explains password-protected and damaged PDFs in plain words', async () => {
    const { pdfErrorText } = await import('../../src/viewing/PdfPages.jsx');
    expect(pdfErrorText({ name: 'PasswordException', message: 'No password given' })).toBe('This PDF is password-protected.');
    expect(pdfErrorText({ name: 'InvalidPDFException' })).toBe('This file is damaged or isn’t really a PDF.');
    expect(pdfErrorText(new Error('x'))).toBe('This PDF couldn’t be opened.');
  });
});
