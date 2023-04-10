// ==UserScript==
// @name         Cppreference-append-support-info
// @version      2.1
// @description  Append support information to cppreference pages
// @author       cpp_learner
// @match        https://en.cppreference.com/w/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cppreference.com
// @grant        none
// ==/UserScript==

(function() {
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

    let since = revs.length, until = 0;
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

function process_feature_test_macro_table(table) {
    const arr = convert_table_to_array(table).slice(1);
    if (table.matches('.ftm-has-value')) {
        return arr.map(row => ({name: row[0].textContent.trim(), value: row[1].textContent.trim()}));
    } else {
        return arr.map(row => ({name: row[0].textContent.trim(), value: undefined}));
    }
}

function get_paper_numbers_in_row(row) {
    return Array.from(row.at(-1).querySelectorAll('.external')).map(link => link.text);
}

async function guess_relevant_papers_from_feature_test_macros() {
    const ftm_tables = Array.from(document.querySelectorAll('.ftm-begin'));
    const macros = ftm_tables.flatMap(table => process_feature_test_macro_table(table));

    if (macros.length === 0) {
        return [];
    }

    const ftm_page = await fetch_pages(['cpp/feature test']);
    const ftm_page_content = new DOMParser().parseFromString(ftm_page[0].revisions[0]['*'], 'text/html');
    const data_tables = Array.from(ftm_page_content.querySelectorAll('.wikitable'));
    const data_rows = data_tables.flatMap(table => convert_table_to_array(table).slice(1, -1));

    const relevant_rows = [];
    for (const row of data_rows) {
        const name = row[0].textContent.trim();
        const value = row[2].textContent.trim();
        for (const macro of macros) {
            if (macro.name === name && (!macro.value || macro.value === value)) {
                relevant_rows.push(row);
            }
        }
    }

    return relevant_rows.flatMap(row => get_paper_numbers_in_row(row));
}

function is_relevant_row(row, relevant_papers) {
    const links = Array.from(row.querySelectorAll('a'));
    if (links.some(a => `${document.URL}/`.startsWith(`${a.href}/`))) {
        return true;
    }
    const header = document.querySelector('.t-dcl-begin .t-dsc-header a');
    if (header && links.some(a => a.href === header.href)) {
        return true;
    }
    const papers = Array.from(row.querySelectorAll('.external'));
    if (papers.some(paper => relevant_papers.includes(paper.text))) {
        return true;
    }
    return false;
}

function get_relevant_rows(content, selector, papers) {
    const table = content.querySelector(selector);
    if (!table) {
        return {body: []};
    }
    const rows = Array.from(table.querySelectorAll('tr'));
    const relevant_rows = rows.slice(1, -1).filter(row => is_relevant_row(row, papers));
    return {head: rows[0], body: relevant_rows};
}

function get_relevant_data(content, papers) {
    return {
        compiler_support: get_relevant_rows(content, '.t-compiler-support-top', papers),
        library_support: get_relevant_rows(content, '.t-standard-library-support-top', papers),
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
                cell.classList.add('table-na');
                cell.style = 'background: #ececec; color: grey; vertical-align: middle; text-align: center;';
                const element = document.createElement('small');
                element.textContent = 'N/A';
                cell.append(element);
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

function create_support_table(data) {
    const table = document.createElement('table');
    table.classList.add('wikitable', 'support-info-table');
    table.style.fontSize = '0.8em';

    const tbody = table.createTBody();
    if (data.body.length !== 0) {
        const head = data.head;
        head.cells[0].innerText = 'Feature\n\xA0';
        head.lastElementChild.remove();
        tbody.append(head);
        tbody.append(...data.body);
    }
    return table;
}

async function append_support_table(is_cxx, revs) {
    const get_pagename = rev => `Template:${is_cxx ? 'cpp' : 'c'}/compiler support/${rev}`;

    const fetch_data_promise = fetch_pages(revs.map(get_pagename));
    const guess_papers_promise = guess_relevant_papers_from_feature_test_macros();

    const [pages, relevant_papers] = await Promise.all([fetch_data_promise, guess_papers_promise]);

    const relevant_revs = guess_relevant_revs(is_cxx ? 'cxx' : 'c', revs);
    const relevant_pagenames = relevant_revs.map(get_pagename);

    const relevant_support_pages = pages.filter(page => relevant_pagenames.includes(page.title));

    const compiler_support = {body: []};
    const library_support = {body: []};

    for (const page of relevant_support_pages) {
        const content = new DOMParser().parseFromString(page.revisions[0]['*'], 'text/html');
        const data = get_relevant_data(content, relevant_papers);
        merge_support_data(compiler_support, data.compiler_support);
        merge_support_data(library_support, data.library_support);
    }

    const current_page_content = document.querySelector('#mw-content-text');
    if (compiler_support.body.length !== 0 || library_support.body.length !== 0) {
        const headline = document.createElement('h3');
        headline.textContent = 'Support status';
        current_page_content.append(headline);
        current_page_content.append(create_support_table(compiler_support));
        current_page_content.append(create_support_table(library_support));
    }
}

const is_cxx = !document.URL.match(/\bc\//);
const revs = is_cxx ? ['11', '14', '17', '20', '23', '26'] : ['99', '23'];
append_support_table(is_cxx, revs);
})();
