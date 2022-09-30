// ==UserScript==
// @name         Cppreference-append-support-info
// @version      1.0
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
    const marker = Array.from(document.querySelectorAll('#firstHeading > .t-mark-rev'));
    if (marker.length !== 0) {
        return marker;
    }
    const dcl = Array.from(document.querySelectorAll('.t-dcl-begin:not(h3 ~ *, .t-member *)'));
    return dcl.flatMap(elem => Array.from(elem.querySelectorAll('.t-dcl-rev-notes, .t-dcl:not(.t-dcl-rev-notes *)')));
}

function guess_relevant_revs(lang, revs) {
    const marker = get_revision_marker_in_page();

    var since = undefined, until = revs.length;
    for (const [i, rev] of revs.entries()) {
        if (marker.some(elem => elem.classList.contains(`t-since-${lang}${rev}`))) {
            since = since ?? i;
        }
        if (marker.some(elem => elem.classList.contains(`t-until-${lang}${rev}`))) {
            until = i;
        }
    }
    return revs.slice(since, until);
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
    return false;
}

function get_relevant_rows(content, selector) {
    const table = content.querySelector(selector);
    if (!table) {
        return {body: []};
    }
    const rows = Array.from(table.querySelectorAll('tr'));
    const relevant_rows = rows.slice(1, -1).filter(is_relevant_row);
    return {head: rows[0], body: relevant_rows};
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

    const pages = await fetch_pages(revs.map(get_pagename));

    const compiler_support = {body: []};
    const library_support = {body: []};

    const relevant_revs = guess_relevant_revs(is_cxx ? 'cxx' : 'c', revs);
    const relevant_pagenames = relevant_revs.map(get_pagename);

    const relevant_pages = pages.filter(page => relevant_pagenames.includes(page.title));

    for (const page of relevant_pages) {
        const content = new DOMParser().parseFromString(page.revisions[0]['*'], 'text/html');
        merge_support_data(compiler_support, get_relevant_rows(content, '.t-compiler-support-top'));
        merge_support_data(library_support, get_relevant_rows(content, '.t-standard-library-support-top'));
    }

    const current_page_content = document.querySelector('#mw-content-text');
    current_page_content.append(create_support_table(compiler_support));
    current_page_content.append(create_support_table(library_support));
}

const is_cxx = !document.URL.match(/\bc\//);
const revs = is_cxx ? ['11', '14', '17', '20', '23', '26'] : ['99', '23'];
append_support_table(is_cxx, revs);
})();
