// The build pipeline: an exact port of vendor/makefun-site/index.js.

import { JVal, J_OBJ, J_ARR } from './json';
import { parseFrontMatter, FrontMatter } from './frontmatter';
import { renderMarkdown, LinkEnv, TocEntry } from './markdown';
import {
  parseTemplate, renderNodes, RenderCtx, Scope, TNode, TVal, VarMap,
  tStr, tNum, tBool, tArr, tObj, tNull,
} from './template';
import { longDate, slugify, uniqueSlug, wordsOf } from './text';
import { codeAt, cmpStr, splitChar, StrBuf } from './util';

/** One Markdown source. */
export class Source {
  path: string = '';
  text: string = '';
  fm: FrontMatter = new FrontMatter();
  body: string = '';
  post: bool = false;
  layout: string = '';
  slug: string = '';
  outDir: string = '';
  url: string = '';
  html: string = '';
  toc: Array<TocEntry> = new Array<TocEntry>();
  excerpt: string = '';
  newer: Source | null = null;
  older: Source | null = null;
  tagRefs: Array<Tag> = new Array<Tag>();
  card: TVal | null = null;
}

/** One static file. */
export class StaticFile {
  path: string = '';
  content: string = '';
}

/** One tag, grouped by slug. */
export class Tag {
  name: string = '';
  slug: string = '';
  url: string = '';
  posts: Array<Source> = new Array<Source>();
}

/** One build's state. */
export class Build {
  base: string = '';
  siteTitle: string = '';
  perPage: i32 = 1;
  recent: i32 = 0;
  templates: Map<string, Array<TNode>> = new Map<string, Array<TNode>>();
  sources: Array<Source> = new Array<Source>();
  statics: Array<StaticFile> = new Array<StaticFile>();
  bySource: Map<string, Source> = new Map<string, Source>();
  broken: Set<string> = new Set<string>();
  report: Array<string> = new Array<string>();
  posts: Array<Source> = new Array<Source>();
  tags: Array<Tag> = new Array<Tag>();
  outputKeys: Array<string> = new Array<string>();
  outputVals: Map<string, string> = new Map<string, string>();

  outputHas(path: string): bool {
    return this.outputVals.has(path);
  }

  outputSet(path: string, text: string): void {
    if (!this.outputVals.has(path)) this.outputKeys.push(path);
    this.outputVals.set(path, text);
  }
}

const RESERVED: Array<string> = ['posts', 'tags', 'page'];

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i == -1 ? '' : path.slice(0, i);
}

/** `text` with every "\r\n" or lone "\r" made "\n". */
function normalizeCRLF(text: string): string {
  let out: StrBuf | null = null;
  let runStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) == 13) {
      if (out === null) out = new StrBuf();
      if (i > runStart) out.add(text.slice(runStart, i));
      out.addChar(10);
      if (codeAt(text, i + 1) == 10) i++;
      runStart = i + 1;
    }
  }
  if (out === null) return text;
  if (text.length > runStart) out.add(text.slice(runStart));
  return out.toString();
}

/** `rel` from the directory `dir`, or null when it climbs out of the root. */
function resolvePath(dir: string, rel: string): string | null {
  const parts = new Array<string>();
  if (dir != '') {
    const d = splitChar(dir, 47);
    for (let i = 0; i < d.length; i++) parts.push(d[i]);
  }
  const segs = splitChar(rel, 47);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg == '' || seg == '.') continue;
    if (seg == '..') {
      if (parts.length == 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Whether `target` opens on a URI scheme: /^[A-Za-z][A-Za-z0-9+.-]*:/. */
function hasScheme(target: string): bool {
  if (target.length < 2) return false;
  const first = target.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  for (let i = 1; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c == 58) return true; // ':'
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 43 || c == 45 || c == 46)) return false;
  }
  return false;
}

/** One source's link resolver, for its Markdown. */
class SourceLinkEnv extends LinkEnv {
  b: Build;
  s: Source;
  dir: string;
  staticPaths: Set<string>;

  constructor(b: Build, s: Source, dir: string, staticPaths: Set<string>) {
    super();
    this.b = b;
    this.s = s;
    this.dir = dir;
    this.staticPaths = staticPaths;
  }

  resolve(target: string): string {
    if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) return target;
    const hash = target.indexOf('#');
    const rel = hash == -1 ? target : target.slice(0, hash);
    const frag = hash == -1 ? '' : target.slice(hash);
    const path: string | null = rel == '' ? null : resolvePath(this.dir, rel);
    if (path !== null && this.b.bySource.has(path)) return this.b.bySource.get(path).url + frag;
    if (path !== null && this.staticPaths.has(path)) return this.b.base + '/' + path + frag;
    this.b.broken.add(`broken-link ${this.s.path} -> ${target}`);
    return target;
  }
}

/** A source's tags, each slug once, in its own order. */
function ownTags(s: Source): Array<string> {
  const seen = new Set<string>();
  const out = new Array<string>();
  const tags = s.fm.hasTags ? s.fm.tags : new Array<string>();
  for (let i = 0; i < tags.length; i++) {
    const slug = slugify(tags[i]);
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push(tags[i]);
    }
  }
  return out;
}

/** A page's link record as templates read it. */
function linkOf(s: Source | null): TVal {
  if (s === null) return tNull();
  const v = tObj();
  v.set('title', tStr(s.fm.title));
  v.set('url', tStr(s.url));
  v.set('date', tStr(s.fm.hasDate ? s.fm.date : ''));
  v.set('date_long', tStr(s.fm.hasDate ? longDate(s.fm.date) : ''));
  return v;
}

/** A post's card, as lists show it. */
function cardOf(s: Source): TVal {
  const v = tObj();
  v.set('title', tStr(s.fm.title));
  v.set('url', tStr(s.url));
  v.set('date', tStr(s.fm.hasDate ? s.fm.date : ''));
  v.set('date_long', tStr(s.fm.hasDate ? longDate(s.fm.date) : ''));
  v.set('summary', tStr(s.fm.hasSummary ? s.fm.summary : ''));
  v.set('excerpt', tStr(s.excerpt));
  const words = wordsOf(s.body);
  const minutes = (words + 199) / 200;
  v.set('reading_minutes', tNum(minutes < 1 ? 1 : minutes));
  const tags = new Array<TVal>();
  for (let i = 0; i < s.tagRefs.length; i++) {
    const t = s.tagRefs[i];
    const tv = tObj();
    tv.set('name', tStr(t.name));
    tv.set('slug', tStr(t.slug));
    tv.set('url', tStr(t.url));
    tags.push(tv);
  }
  v.set('tags', tArr(tags));
  return v;
}

/** A page as its layout reads it. */
function pageOf(s: Source): TVal {
  // A post's card is already built (layouts); copy its fields instead of rebuilding.
  let v: TVal;
  const card = s.card;
  if (card !== null) {
    v = tObj();
    const keys = (card.obj as VarMap).keys;
    for (let i = 0; i < keys.length; i++) v.set(keys[i], card.get(keys[i]));
  } else {
    v = cardOf(s);
  }
  v.set('slug', tStr(s.slug));
  v.set('content', tStr(s.html));
  const toc = new Array<TVal>();
  for (let i = 0; i < s.toc.length; i++) {
    const h = s.toc[i];
    const hv = tObj();
    hv.set('level', tNum(h.level));
    hv.set('id', tStr(h.id));
    hv.set('html', tStr(h.html));
    toc.push(hv);
  }
  v.set('toc', tArr(toc));
  v.set('newer', linkOf(s.newer));
  v.set('older', linkOf(s.older));
  v.set('is_post', tBool(s.post));
  return v;
}

/** A tag as templates read it (its posts as cards). */
function tagOf(t: Tag): TVal {
  const v = tObj();
  v.set('name', tStr(t.name));
  v.set('slug', tStr(t.slug));
  v.set('url', tStr(t.url));
  v.set('count', tNum(t.posts.length));
  const posts = new Array<TVal>();
  for (let i = 0; i < t.posts.length; i++) {
    const c = t.posts[i].card;
    posts.push(c === null ? tNull() : c);
  }
  v.set('posts', tArr(posts));
  return v;
}

/** JS `Array.prototype.slice(0, n)` on an array of length `len`: the end index. */
function sliceEnd(n: i32, len: i32): i32 {
  if (n < 0) {
    const e = len + n;
    return e < 0 ? 0 : e;
  }
  return n > len ? len : n;
}

/** 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static. */
function readSources(b: Build, files: JVal): void {
  const arr = files.arr as Array<JVal>;
  // Sort a copy of the file list by path, code-unit order.
  const sorted = new Array<JVal>();
  for (let i = 0; i < arr.length; i++) sorted.push(arr[i]);
  sorted.sort((x: JVal, y: JVal): i32 => {
    const xp = x.get('path');
    const yp = y.get('path');
    return cmpStr(xp === null ? '' : xp.s, yp === null ? '' : yp.s);
  });
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const p = f.get('path');
    const c = f.get('content');
    const path = p === null ? '' : p.s;
    const content = c === null ? '' : c.s;
    if (path.endsWith('.md')) {
      const s = new Source();
      s.path = path;
      s.text = normalizeCRLF(content);
      b.sources.push(s);
    } else {
      const st = new StaticFile();
      st.path = path;
      st.content = content;
      b.statics.push(st);
    }
  }
}

/** 2. Each source's front matter: a refused source is reported and dropped, and so is a draft. */
function frontMatter(b: Build): void {
  const kept = new Array<Source>();
  for (let i = 0; i < b.sources.length; i++) {
    const s = b.sources[i];
    const fm = parseFrontMatter(s.text);
    if (fm.error != '') {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.fm = fm;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own: string | null = null;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== null) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !s.fm.hasDate) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.fm.hasLayout ? s.fm.layout : s.post ? 'post' : 'page';
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.fm.hasDraft && s.fm.draft) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

/** 3. Each page's output directory and url: its slug made unique in its directory, in source order. */
function permalinks(b: Build): void {
  const taken = new Map<string, Set<string>>();
  for (let i = 0; i < b.sources.length; i++) {
    const s = b.sources[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set: Set<string>;
    if (!taken.has(dir)) {
      set = new Set<string>();
      if (dir == '') {
        for (let k = 0; k < RESERVED.length; k++) set.add(RESERVED[k]);
      }
      taken.set(dir, set);
    } else {
      set = taken.get(dir);
    }
    const base = s.fm.hasSlug ? s.fm.slug : slugify(s.fm.title);
    const slug = uniqueSlug(base, set);
    s.slug = slug;
    s.outDir = dir == '' ? slug : dir + '/' + slug;
    s.url = b.base + '/' + s.outDir + '/';
    b.bySource.set(s.path, s);
  }
}

/** 4. Each body's Markdown, its links resolved to the pages and static files they name. */
function markdown(b: Build): void {
  const staticPaths = new Set<string>();
  for (let i = 0; i < b.statics.length; i++) staticPaths.add(b.statics[i].path);
  for (let i = 0; i < b.sources.length; i++) {
    const s = b.sources[i];
    const env = new SourceLinkEnv(b, s, dirOf(s.path), staticPaths);
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
}

/** 5. The posts, newest first and then by slug; each post's newer and older neighbours. */
function collections(b: Build): void {
  const posts = new Array<Source>();
  for (let i = 0; i < b.sources.length; i++) if (b.sources[i].post) posts.push(b.sources[i]);
  posts.sort((x: Source, y: Source): i32 => {
    const byDate = cmpStr(y.fm.date, x.fm.date);
    if (byDate != 0) return byDate;
    return cmpStr(x.slug, y.slug);
  });
  b.posts = posts;
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k == 0 ? null : posts[k - 1];
    posts[k].older = k == posts.length - 1 ? null : posts[k + 1];
  }
}

/** 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug. */
function tags(b: Build): void {
  const bySlug = new Map<string, Tag>();
  for (let i = 0; i < b.posts.length; i++) {
    const p = b.posts[i];
    p.tagRefs = new Array<Tag>();
    const names = ownTags(p);
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      const slug = slugify(name);
      let tag: Tag;
      if (!bySlug.has(slug)) {
        tag = new Tag();
        tag.name = name;
        tag.slug = slug;
        tag.url = b.base + '/tags/' + slug + '/';
        bySlug.set(slug, tag);
      } else {
        tag = bySlug.get(slug);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < b.sources.length; i++) {
    const s = b.sources[i];
    if (s.post) continue;
    const refs = new Array<Tag>();
    const names = ownTags(s);
    for (let j = 0; j < names.length; j++) {
      const slug = slugify(names[j]);
      if (!bySlug.has(slug)) {
        const t = new Tag();
        t.name = names[j];
        t.slug = slug;
        t.url = '';
        refs.push(t);
      } else refs.push(bySlug.get(slug));
    }
    s.tagRefs = refs;
  }
  const all = bySlug.values();
  all.sort((x: Tag, y: Tag): i32 => {
    const byCount = y.posts.length - x.posts.length;
    if (byCount != 0) return byCount;
    return cmpStr(x.slug, y.slug);
  });
  b.tags = all;
}

/** The layouts plugin's renderer: the shared scope values and the render helper. */
class LayoutRenderer {
  b: Build;
  site: TVal;
  allTags: Array<TVal>;
  recentPosts: Array<TVal>;
  ctx: RenderCtx;

  constructor(b: Build, site: TVal, allTags: Array<TVal>, recentPosts: Array<TVal>, ctx: RenderCtx) {
    this.b = b;
    this.site = site;
    this.allTags = allTags;
    this.recentPosts = recentPosts;
    this.ctx = ctx;
  }

  /** Render template `name` in a scope of site, tags, recent and `vars`; null when it is no template that parses. */
  render(name: string, vars: VarMap): string | null {
    if (!this.b.templates.has(name)) return null;
    const scope = new Scope();
    scope.vars.set('site', this.site);
    scope.vars.set('tags', tArr(this.allTags));
    scope.vars.set('recent', tArr(this.recentPosts));
    const keys = vars.keys;
    for (let i = 0; i < keys.length; i++) scope.vars.set(keys[i], vars.get(keys[i]));
    const out = new StrBuf();
    renderNodes(this.b.templates.get(name), scope, this.ctx, 0, out);
    return out.toString();
  }

  /** An index page's url: the root for page 1, /page/<k>/ after. */
  indexUrl(k: i32): string {
    return k == 1 ? this.b.base + '/' : this.b.base + '/page/' + k.toString() + '/';
  }
}

/** 7. Every page through its layout, the index pages and the tag pages through theirs. */
function layouts(b: Build): void {
  for (let i = 0; i < b.posts.length; i++) b.posts[i].card = cardOf(b.posts[i]);
  const site = tObj();
  site.set('title', tStr(b.siteTitle));
  site.set('base_url', tStr(b.base));
  const allTags = new Array<TVal>();
  for (let i = 0; i < b.tags.length; i++) {
    const t = b.tags[i];
    const tv = tObj();
    tv.set('name', tStr(t.name));
    tv.set('slug', tStr(t.slug));
    tv.set('url', tStr(t.url));
    tv.set('count', tNum(t.posts.length));
    allTags.push(tv);
  }
  const recentPosts = new Array<TVal>();
  const recentEnd = sliceEnd(b.recent, b.posts.length);
  for (let i = 0; i < recentEnd; i++) {
    const c = b.posts[i].card;
    recentPosts.push(c === null ? tNull() : c);
  }
  const ctx = new RenderCtx();
  ctx.templates = b.templates;
  const r = new LayoutRenderer(b, site, allTags, recentPosts, ctx);
  for (let i = 0; i < b.sources.length; i++) {
    const s = b.sources[i];
    const vars = new VarMap();
    vars.set('page', pageOf(s));
    const html = r.render(s.layout, vars);
    if (html !== null) b.outputSet(s.outDir + '/index.html', html);
  }
  const per = b.perPage < 1 ? 1 : b.perPage;
  let pages = (b.posts.length + per - 1) / per;
  if (pages < 1) pages = 1;
  for (let k = 1; k <= pages; k++) {
    const vars = new VarMap();
    const pagePosts = new Array<TVal>();
    const from = (k - 1) * per;
    let to = k * per;
    if (to > b.posts.length) to = b.posts.length;
    for (let i = from; i < to; i++) {
      const c = b.posts[i].card;
      pagePosts.push(c === null ? tNull() : c);
    }
    vars.set('posts', tArr(pagePosts));
    const pager = tObj();
    pager.set('number', tNum(k));
    pager.set('total', tNum(pages));
    pager.set('url', tStr(r.indexUrl(k)));
    pager.set('newer_url', tStr(k == 1 ? '' : r.indexUrl(k - 1)));
    pager.set('older_url', tStr(k == pages ? '' : r.indexUrl(k + 1)));
    vars.set('pager', pager);
    const html = r.render('index', vars);
    if (html !== null) b.outputSet(k == 1 ? 'index.html' : 'page/' + k.toString() + '/index.html', html);
  }
  for (let i = 0; i < b.tags.length; i++) {
    const t = b.tags[i];
    const vars = new VarMap();
    vars.set('tag', tagOf(t));
    const html = r.render('tag', vars);
    if (html !== null) b.outputSet('tags/' + t.slug + '/index.html', html);
  }
  const tagsHtml = r.render('tags', new VarMap());
  if (tagsHtml !== null) b.outputSet('tags/index.html', tagsHtml);
  for (let i = 0; i < b.statics.length; i++) {
    const f = b.statics[i];
    if (b.outputHas(f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.outputSet(f.path, f.content);
  }
}

/** 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts. */
function report(b: Build): void {
  const lines = new Array<string>();
  for (let i = 0; i < b.report.length; i++) lines.push(b.report[i]);
  const broken = b.broken.values();
  for (let i = 0; i < broken.length; i++) lines.push(broken[i]);
  lines.sort((a: string, c: string): i32 => cmpStr(a, c));
  let pages = 0;
  for (let i = 0; i < b.sources.length; i++) if (!b.sources[i].post) pages++;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.outputSet('build-report.txt', lines.join('\n') + '\n');
}

/** Strip trailing slashes: base_url.replace(/\/+$/, ''). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) == 47) end--;
  return s.slice(0, end);
}

/** One site's output tree. */
export function build(input: JVal): Build {
  const b = new Build();
  const templates = input.get('templates');
  if (templates !== null && templates.kind == J_OBJ) {
    const tkeys = templates.keys as Array<string>;
    const names = new Array<string>();
    for (let i = 0; i < tkeys.length; i++) names.push(tkeys[i]);
    names.sort((a: string, c: string): i32 => cmpStr(a, c));
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const src = templates.get(name);
      const parsed = parseTemplate(name, src === null ? '' : src.s);
      if (parsed.error != '') b.report.push(parsed.error);
      else b.templates.set(name, parsed.nodes);
    }
  }
  const site = input.get('site');
  if (site !== null) {
    const title = site.get('title');
    const baseUrl = site.get('base_url');
    const perPage = site.get('per_page');
    const recent = site.get('recent');
    b.siteTitle = title === null ? '' : title.s;
    b.base = baseUrl === null ? '' : stripTrailingSlashes(baseUrl.s);
    b.perPage = perPage === null ? 1 : <i32>perPage.n;
    b.recent = recent === null ? 0 : <i32>recent.n;
  }
  const files = input.get('files');
  if (files !== null && files.kind == J_ARR) readSources(b, files);
  frontMatter(b);
  permalinks(b);
  markdown(b);
  collections(b);
  tags(b);
  layouts(b);
  report(b);
  return b;
}
