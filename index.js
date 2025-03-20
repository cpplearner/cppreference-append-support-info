// ==UserScript==
// @name         Cppreference-append-support-info
// @version      4.0
// @description  Append support information to cppreference pages
// @author       cpp_learner
// @match        https://en.cppreference.com/w/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cppreference.com
// @grant        none
// ==/UserScript==

(function() {
const HEADLINE_TEXT = 'Support status';
const NOTE_TEMPLATE =
    '<small>The support data are automatically generated from $0. Some rows might be inapplicable to this page.</small>';
const CXX_SUPPORT_LINK = '<a href="/w/cpp/compiler_support" title="cpp/compiler support">C++ compiler support</a>';
const C_SUPPORT_LINK = '<a href="/w/c/compiler_support" title="c/compiler support">C compiler support</a>';
const MISSING_CELL =
    '<td style="background:#ececec;color:grey;vertical-align:middle;text-align:center;" class="table-na">' +
    '<small>N/A</small></td>';
const TABLE_HEAD_TEXT = 'Feature\n\xA0';

async function fetch_pages(pagenames) {
    const params = new URLSearchParams({
        format: 'json',
        action: 'query',
        prop: 'revisions',
        rvprop: 'content',
        rvparse: true,
        titles: pagenames.join('|'),
    });
    const apiresult = await fetch('/mwiki/api.php?' + params.toString()).then(r => r.json());
    return Object.values(apiresult.query.pages);
}

function get_revision_marker_in_page() {
    const marker = document.querySelector('#firstHeading > .t-mark-rev');
    if (marker !== null) {
        return [new Set(marker.classList)];
    }
    const dcl = Array.from(document.querySelectorAll('.t-dcl-begin:not(h3 ~ *, .t-member *)'));
    const elems = dcl.flatMap(elem => Array.from(elem.querySelectorAll('.t-dcl-rev-notes, .t-dcl:not(.t-dcl-rev-notes *)')));
    return elems.map(elem => new Set(elem.classList));
}

function guess_relevant_revs(lang, revs) {
    const markers_class_sets = get_revision_marker_in_page();

    if (markers_class_sets.length === 0) {
        return revs;
    }

    let since = revs.length;
    let until = 0;
    for (const class_set of markers_class_sets) {
        let has_since = false;
        let has_until = false;
        for (const [i, rev] of revs.entries()) {
            if (class_set.has(`t-since-${lang}${rev}`)) {
                has_since = true;
                since = Math.min(since, i);
            }
            if (class_set.has(`t-until-${lang}${rev}`)) {
                has_until = true;
                until = Math.max(until, i);
            }
        }
        since = has_since ? since : 0;
        until = has_until ? until : revs.length;
    }

    return revs.slice(since, until + 1);
}

function convert_table_to_array(table) {
    const result = [];
    let row_index = 0;
    for (const row of table.rows) {
        if (!result[row_index]) {
            result[row_index] = [];
        }
        let cell_index = 0;
        for (const cell of row.cells) {
            while (result[row_index][cell_index]) {
                ++cell_index;
            }
            for (let i = 0; i < cell.rowSpan; ++i) {
                if (!result[row_index + i]) {
                    result[row_index + i] = [];
                }
                result[row_index + i][cell_index] = cell;
            }
        }
        ++row_index;
    }
    return result;
}

function get_feature_test_macros(ftm_table) {
    const arr = convert_table_to_array(ftm_table).slice(1);
    return arr.map(row => `${row[0].textContent.trim().slice(2)}_${row[1].textContent.trim()}`);
}

function get_anchors(row) {
    return Array.from(row.querySelectorAll('[id]')).map(elem => elem.id);
}

function get_paper_numbers(elem) {
    return Array.from(elem.querySelectorAll('.external')).map(link => link.text.replace(/R\d*/iu, ''));
}

function guess_relevant_papers_from_dr_list() {
    const dr_lists = Array.from(document.querySelectorAll('.dsctable'));
    return dr_lists.flatMap(dr_list => get_paper_numbers(dr_list));
}

function is_relevant_row(row) {
    const links = Array.from(row.querySelectorAll('a'));
    if (links.some(a => `${document.URL}/`.startsWith(`${a.href}/`))) {
        return true;
    }
    const header = document.querySelector('.t-dcl-begin .t-dsc-header a');
    if (header && links.some(a => a.href === header.href)) {
        return true;
    }
    const ftm_tables = Array.from(document.querySelectorAll('.ftm-begin'));
    const relevant_macros = ftm_tables.flatMap(table => get_feature_test_macros(table));
    const anchors = get_anchors(row);
    if (anchors.some(anchor => relevant_macros.includes(anchor))) {
        return true;
    }
    const relevant_papers = guess_relevant_papers_from_dr_list();
    const papers = get_paper_numbers(row);
    if (papers.some(paper => relevant_papers.includes(paper))) {
        return true;
    }
    return false;
}

function get_relevant_rows(support_page_content, selector) {
    const table = support_page_content.querySelector(selector);
    if (!table) {
        return {body: []};
    }
    const rows = Array.from(table.querySelectorAll('tr'));
    const relevant_rows = rows.slice(1, -1).filter(is_relevant_row);
    return {head: rows[0], body: relevant_rows};
}

function get_relevant_support_data(support_page_content) {
    return {
        compiler_support: get_relevant_rows(support_page_content, '.t-compiler-support-top'),
        library_support: get_relevant_rows(support_page_content, '.t-standard-library-support-top'),
    };
}

function are_matching_cells(cell1, cell2) {
    return cell1.textContent.trim() === cell2.textContent.trim();
}

function fixup_missing_columns(dst_data, src_data) {
    const dst_head_cells = Array.from(dst_data.head.cells);
    const src_head_cells = src_data.head.cells;
    for (let i = 1; i < src_head_cells.length; ++i) {
        const src_cell = src_head_cells[i];
        const src_cell_in_dst_head = dst_head_cells.some(dst_cell => are_matching_cells(dst_cell, src_cell));
        if (!src_cell_in_dst_head) {
            dst_data.head.insertBefore(src_cell.cloneNode(true), dst_head_cells[i]);
            for (const row of dst_data.body) {
                const cell = row.insertCell(i);
                cell.outerHTML = MISSING_CELL;
            }
        }
    }
}

function merge_support_data(old_data, new_data) {
    if (!new_data.head || new_data.body.length === 0) {
        return;
    } else if (!old_data.head) {
        old_data.head = new_data.head;
        old_data.body = new_data.body;
    } else {
        fixup_missing_columns(old_data, new_data);
        fixup_missing_columns(new_data, old_data);
        old_data.body = old_data.body.concat(new_data.body);
    }
}

function append_support_table(current_page_content, data, kind) {
    if (data.body.length !== 0) {
        const table = document.createElement('table');
        table.classList.add('wikitable', 'support-data-begin', `${kind}-support-data-begin`);
        table.style.fontSize = '0.8em';

        const tbody = table.createTBody();
        const head = data.head;
        head.cells[0].innerText = TABLE_HEAD_TEXT;
        head.lastElementChild.remove();
        tbody.append(head);
        tbody.append(...data.body);

        current_page_content.append(table);
    }
}

async function append_support_info(is_cxx, revs) {
    const get_pagename = rev => `Template:${is_cxx ? 'cpp' : 'c'}/compiler support/${rev}`;

    const pages = await fetch_pages(revs.map(get_pagename));

    const relevant_revs = guess_relevant_revs(is_cxx ? 'cxx' : 'c', revs);
    const relevant_support_pagenames = relevant_revs.map(get_pagename);

    const relevant_support_pages = pages.filter(page => relevant_support_pagenames.includes(page.title));

    const compiler_support = {body: []};
    const library_support = {body: []};

    for (const page of relevant_support_pages) {
        const content = new DOMParser().parseFromString(page.revisions[0]['*'], 'text/html');
        const data = get_relevant_support_data(content);
        merge_support_data(compiler_support, data.compiler_support);
        merge_support_data(library_support, data.library_support);
    }

    const current_page_content = document.querySelector('#mw-content-text');
    if (compiler_support.body.length !== 0 || library_support.body.length !== 0) {
        const headline = document.createElement('h3');
        headline.textContent = HEADLINE_TEXT;
        const note = document.createElement('p');
        note.innerHTML = NOTE_TEMPLATE.replace('$0', is_cxx ? CXX_SUPPORT_LINK : C_SUPPORT_LINK);

        current_page_content.append(headline);
        current_page_content.append(note);

        append_support_table(current_page_content, compiler_support, 'core');
        append_support_table(current_page_content, library_support, 'lib');
    }
}

const is_cxx = !document.URL.match(/\bc\//);
const revs = is_cxx ? ['11', '14', '17', '20', '23', '26'] : ['99', '23'];
append_support_info(is_cxx, revs);
})();
