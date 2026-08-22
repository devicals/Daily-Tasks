const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, normalizePath } = require("obsidian");
const { ViewPlugin, Decoration, MatchDecorator, WidgetType } = require("@codemirror/view");

const NUMBER_WORDS = {
    "zero": 0, "a": 1, "an": 1, "one": 1, "first": 1, "two": 2, "second": 2, "couple": 2,
    "three": 3, "third": 3, "few": 3, "several": 4, "four": 4, "fourth": 4, "five": 5, "fifth": 5,
    "six": 6, "sixth": 6, "seven": 7, "seventh": 7, "eight": 8, "eighth": 8, "nine": 9, "ninth": 9,
    "ten": 10, "tenth": 10, "eleven": 11, "twelfth": 12, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "dozen": 12, "half-dozen": 6, "half dozen": 6
};

const WEEKDAYS = {
    "sunday": 0, "sun": 0, "sundays": 0,
    "monday": 1, "mon": 1, "mondays": 1,
    "tuesday": 2, "tue": 2, "tues": 2, "tuesdays": 2,
    "wednesday": 3, "wed": 3, "wednesdays": 3,
    "thursday": 4, "thu": 4, "thur": 4, "thurs": 4, "thursdays": 4,
    "friday": 5, "fri": 5, "fridays": 5,
    "saturday": 6, "sat": 6, "saturdays": 6
};

function normalizeNaturalText(str) {
    let s = str.toLowerCase()
        .replace(/[\,\.]/g, " ")
        .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
        .replace(/\b(st|nd|rd|th)\b/g, " ")
        .replace(/\bof\b/g, " ");

    s = s.replace(/\bevery\s+other\s+day\b/g, "2 days")
         .replace(/\bevery\s+other\s+week\b/g, "2 weeks")
         .replace(/\bevery\s+other\s+month\b/g, "2 months")
         .replace(/\bevery\s+other\s+year\b/g, "2 years")
         .replace(/\b(fortnightly|biweekly|bi-weekly|bi weekly)\b/g, "2 weeks")
         .replace(/\b(fortnight|fortnights)\b/g, "2 weeks")
         .replace(/\b(triweekly|tri-weekly|tri weekly)\b/g, "3 weeks")
         .replace(/\b(quadweekly|quad-weekly|quad weekly)\b/g, "4 weeks")
         .replace(/\b(bidaily|bi-daily|bi daily)\b/g, "2 days")
         .replace(/\b(tridaily|tri-daily|tri daily)\b/g, "3 days")
         .replace(/\b(quaddaily|quad-daily|quad daily)\b/g, "4 days")
         .replace(/\b(bimonthly|bi-monthly|bi monthly)\b/g, "2 months")
         .replace(/\b(trimonthly|tri-monthly|tri monthly|quarterly)\b/g, "3 months")
         .replace(/\b(quadmonthly|quad-monthly|quad monthly)\b/g, "4 months")
         .replace(/\b(semiannually|semi-annually|semi annually|half-yearly|half yearly|biannually|bi-annually|biannual|semiannual)\b/g, "6 months")
         .replace(/\b(annually|annual|yearly)\b/g, "1 year")
         .replace(/\b(triennially|triennial)\b/g, "3 years")
         .replace(/\b(quadrennially|quadrennial)\b/g, "4 years")
         .replace(/\b(quinquennially|quinquennial)\b/g, "5 years")
         .replace(/\b(decennially|decennial)\b/g, "10 years")
         .replace(/\b(the\s+day\s+after\s+tomorrow|overmorrow)\b/g, "2 days")
         .replace(/\b(the\s+day\s+before\s+yesterday)\b/g, "-2 days")
         .replace(/-/g, " ");

    const tokens = s.split(/\s+/).filter(Boolean);
    const resolved = [];
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (NUMBER_WORDS[t] !== undefined) {
            let val = NUMBER_WORDS[t];
            if (val >= 20 && i + 1 < tokens.length && NUMBER_WORDS[tokens[i + 1]] !== undefined && NUMBER_WORDS[tokens[i + 1]] < 10) {
                val += NUMBER_WORDS[tokens[i + 1]];
                i++;
            }
            resolved.push(val.toString());
        } else {
            resolved.push(t);
        }
        i++;
    }
    return resolved.join(" ");
}

function parseInterval(text) {
    if (!text) return null;
    const s = normalizeNaturalText(text);
    let days = 0, weeks = 0, months = 0, years = 0;
    let found = false;

    if (/\bdaily\b|\bevery\s+day\b/.test(s)) { days += 1; found = true; }
    if (/\bweekly\b|\bevery\s+week\b/.test(s)) { weeks += 1; found = true; }
    if (/\bmonthly\b|\bevery\s+month\b/.test(s)) { months += 1; found = true; }
    if (/\bannually\b|\byearly\b|\bevery\s+year\b|\bannual\b/.test(s)) { years += 1; found = true; }

    const dMatches = s.matchAll(/(\d+)\s*(?:d|day|days|daily)\b/g);
    for (const m of dMatches) { days += parseInt(m[1], 10); found = true; }

    const wMatches = s.matchAll(/(\d+)\s*(?:w|wk|wks|week|weeks|weekly)\b/g);
    for (const m of wMatches) { weeks += parseInt(m[1], 10); found = true; }

    const mMatches = s.matchAll(/(\d+)\s*(?:m|mo|mon|mons|month|months|monthly)\b/g);
    for (const m of mMatches) { months += parseInt(m[1], 10); found = true; }

    const yMatches = s.matchAll(/(\d+)\s*(?:y|yr|yrs|year|years|yearly|annual|annually)\b/g);
    for (const m of yMatches) { years += parseInt(m[1], 10); found = true; }

    return found ? { days, weeks, months, years } : null;
}

function addToDate(baseDate, interval) {
    const d = baseDate.clone();
    if (interval.years) d.add(interval.years, "years");
    if (interval.months) d.add(interval.months, "months");
    if (interval.weeks) d.add(interval.weeks, "weeks");
    if (interval.days) d.add(interval.days, "days");
    return d;
}

function getNextWeekday(baseDate, targetDayNum) {
    const d = baseDate.clone();
    const currentDay = d.day();
    let diff = targetDayNum - currentDay;
    if (diff <= 0) diff += 7;
    return d.add(diff, "days");
}

function parseNaturalDate(rawStr, baseDate) {
    const s = normalizeNaturalText(rawStr).trim();
    const formats = [
        "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "YYYY/MM/DD",
        "D MMMM YYYY", "D MMM YYYY", "MMMM D YYYY", "MMM D YYYY",
        "DD/MM", "DD-MM", "D MMMM", "D MMM", "MMMM D", "MMM D"
    ];

    for (const f of formats) {
        const m = window.moment(s, f, true);
        if (m.isValid()) {
            const hasYear = f.includes("Y");
            if (!hasYear) {
                m.year(baseDate.year());
                if (m.isBefore(baseDate, 'day')) m.add(1, 'year');
            }
            return { date: m, hasYear };
        }
    }

    for (const [dayName, dayNum] of Object.entries(WEEKDAYS)) {
        const reg = new RegExp(`\\b(?:this|next|on)?\\s*${dayName}\\b`, "i");
        if (reg.test(s)) {
            return { date: getNextWeekday(baseDate, dayNum), hasYear: false };
        }
    }
    return null;
}

function formatRepeatUnits(interval) {
    const nonZero = (interval.days > 0 ? 1 : 0) + (interval.weeks > 0 ? 1 : 0) + (interval.months > 0 ? 1 : 0) + (interval.years > 0 ? 1 : 0);
    if (nonZero === 1) {
        if (interval.days === 1) return "every day";
        if (interval.weeks === 1) return "every week";
        if (interval.months === 1) return "every month";
        if (interval.years === 1) return "every year";
    }

    const parts = [];
    if (interval.years > 0) parts.push(`${interval.years} ${interval.years === 1 ? "year" : "years"}`);
    if (interval.months > 0) parts.push(`${interval.months} ${interval.months === 1 ? "month" : "months"}`);
    if (interval.weeks > 0) parts.push(`${interval.weeks} ${interval.weeks === 1 ? "week" : "weeks"}`);
    if (interval.days > 0) parts.push(`${interval.days} ${interval.days === 1 ? "day" : "days"}`);

    if (parts.length === 0) return "every day";
    if (parts.length === 1) return `every ${parts[0]}`;
    if (parts.length === 2) return `every ${parts[0]} and ${parts[1]}`;
    return `every ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function parseTaskTag(tagRaw, baseDate, existingData = null) {
    const raw = tagRaw.trim();
    if (/^(clear|remove|delete|none|reset)$/i.test(raw)) {
        return { isClear: true };
    }

    const rawSegments = raw.split(/(?:&|,|\band\b)/i).map(s => s.trim()).filter(Boolean);

    let isOptional = existingData ? existingData.isOptional : false;
    let explicitNextDate = null;
    let explicitStartDate = null;
    let explicitSnoozeDate = null;
    let explicitRepeat = null;
    let explicitInterval = null;
    let explicitOrigDate = null;
    let hasExplicitOptional = false;

    for (let segment of rawSegments) {
        let segLower = segment.toLowerCase().trim();

        if (/^(required|mandatory|not\s+optional|unoptional|req)$/i.test(segLower)) {
            isOptional = false;
            hasExplicitOptional = true;
            continue;
        }
        if (/^optional$/i.test(segLower)) {
            isOptional = true;
            hasExplicitOptional = true;
            continue;
        }

        if (/^(?:starting|after|from)\s+/i.test(segLower)) {
            const dateStr = segLower.replace(/^(?:starting|after|from)\s+/i, "").trim();
            const parsedStart = parseNaturalDate(dateStr, baseDate);
            if (parsedStart) explicitStartDate = parsedStart.date;
            continue;
        }

        if (/^snooze\b/i.test(segLower)) {
            const snoozeArg = segLower.replace(/^snooze\s*(?:for|in)?\s*/i, "").trim();
            const snoozeInterval = parseInterval(snoozeArg);
            if (snoozeInterval) {
                explicitSnoozeDate = addToDate(baseDate, snoozeInterval);
            } else if (snoozeArg) {
                const parsed = parseNaturalDate(snoozeArg, baseDate);
                if (parsed) explicitSnoozeDate = parsed.date;
            }
            if (!explicitSnoozeDate) {
                explicitSnoozeDate = baseDate.clone().add(1, "days");
            }
            continue;
        }

        if (/^next\b/i.test(segLower)) {
            const nextArg = segLower.replace(/^next\s*(?:in|on|at|:)?\s*/i, "").trim();
            const nextInterval = parseInterval(nextArg);
            if (nextInterval) {
                explicitNextDate = addToDate(baseDate, nextInterval);
            } else if (nextArg) {
                const parsed = parseNaturalDate(nextArg, baseDate);
                if (parsed) explicitNextDate = parsed.date;
            }
            continue;
        }

        let matchedWeekday = false;
        const cleanRecurPrefix = segLower.replace(/^(?:repeat\s+every|every\s+repeat|repeating\s+every|recurring\s+every|recur\s+every|repeat|repeating|recurring|recur|every|each)\s+/i, "").trim();
        for (const [dayName, dayNum] of Object.entries(WEEKDAYS)) {
            if (new RegExp(`^${dayName}\\b`, "i").test(cleanRecurPrefix)) {
                explicitInterval = { days: 0, weeks: 1, months: 0, years: 0 };
                explicitRepeat = "every week";
                explicitNextDate = explicitNextDate || getNextWeekday(baseDate, dayNum);
                matchedWeekday = true;
                break;
            }
        }
        if (matchedWeekday) continue;

        const isRecurKeyword = /^(?:repeat\s+every|every\s+repeat|repeating\s+every|recurring\s+every|recur\s+every|repeat|repeating|recurring|recur|every|each)\b/i.test(segLower);
        const parsedDateObj = parseNaturalDate(cleanRecurPrefix, baseDate);
        if (parsedDateObj && isRecurKeyword) {
            explicitInterval = { days: 0, weeks: 0, months: 0, years: 1 };
            explicitRepeat = "every year";
            if (parsedDateObj.hasYear) {
                explicitOrigDate = parsedDateObj.date.clone();
                let targetDate = explicitNextDate ? explicitNextDate.clone() : explicitOrigDate.clone();
                if (!explicitNextDate) {
                    while (targetDate.isBefore(baseDate, "day")) {
                        targetDate.add(1, "year");
                    }
                }
                explicitNextDate = targetDate;
            } else {
                explicitNextDate = explicitNextDate || parsedDateObj.date;
            }
            continue;
        }

        const interval = parseInterval(segLower);
        const hasFreqKeyword = /\b(daily|weekly|monthly|annually|annual|yearly|fortnightly|biweekly|bidaily|tridaily|quaddaily|triweekly|quadweekly|bimonthly|trimonthly|quadmonthly|quarterly|semiannually|biannually|half-yearly|triennially|quadrennially|quinquennially|decennially)\b/i.test(segLower);

        if ((isRecurKeyword || hasFreqKeyword) && interval) {
            explicitInterval = interval;
            explicitRepeat = formatRepeatUnits(interval);
            if (!explicitNextDate) {
                explicitNextDate = addToDate(baseDate, interval);
            }
            continue;
        }

        if (segLower === "tomorrow") {
            explicitNextDate = baseDate.clone().add(1, "days");
        } else if (segLower === "yesterday") {
            explicitNextDate = baseDate.clone().subtract(1, "days");
        } else if (segLower.startsWith("in ") || segLower.startsWith("after ")) {
            if (interval) explicitNextDate = addToDate(baseDate, interval);
        } else if (parsedDateObj) {
            explicitNextDate = parsedDateObj.date;
        }
    }

    return {
        isClear: false,
        explicitRepeat,
        explicitInterval,
        explicitNextDate: explicitSnoozeDate || explicitNextDate,
        explicitStartDate,
        explicitOrigDate,
        isOptional,
        hasExplicitOptional
    };
}

function formatOrdinalDate(mDate) {
    const day = mDate.format("D");
    const suffix = mDate.format("Do").replace(/\d+/g, "");
    const month = mDate.format("MMMM").toLowerCase();
    const year = mDate.format("YYYY");
    return `${day}${suffix} of ${month}, ${year}`;
}

function formatCompoundRelativeDiff(targetDate, baseDate) {
    if (targetDate.isSame(baseDate, 'day')) {
        return `(today)`;
    }
    const isPast = targetDate.isBefore(baseDate, 'day');
    const start = isPast ? targetDate.clone().startOf('day') : baseDate.clone().startOf('day');
    const end = isPast ? baseDate.clone().startOf('day') : targetDate.clone().startOf('day');

    const years = end.diff(start, 'years');
    const cur = start.clone().add(years, 'years');
    const months = end.diff(cur, 'months');
    cur.add(months, 'months');
    const totalDays = end.diff(cur, 'days');
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;

    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
    if (weeks > 0) parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`);
    if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);

    if (parts.length === 0) return `(today)`;

    let unitStr = "";
    if (parts.length === 1) {
        unitStr = parts[0];
    } else if (parts.length === 2) {
        unitStr = `${parts[0]} and ${parts[1]}`;
    } else {
        const initial = parts.slice(0, -1).join(`, `);
        unitStr = `${initial}, and ${parts[parts.length - 1]}`;
    }

    if (isPast) {
        return `(${unitStr} ago)`;
    } else {
        return `(in ${unitStr})`;
    }
}

function cleanTaskString(text) {
    return text.replace(/^\s*-\s*\[.\]\s*/, "")
               .replace(/\[(?:<span[^>]*>)?[\?\#\°](?:\s*<\/span>)?\]\{[\s\S]*?\}\s*/g, "")
               .replace(/\{#\|[^}]+\}\s*/g, "")
               .replace(/::\s*[^:\n]*(?:::)?/g, "")
               .replace(/%%[\s\S]*?%%/g, "")
               .replace(/%[^\n]*/g, "")
               .replace(/^#\s+/, "")
               .replace(/\s+/g, " ")
               .trim();
}

function cleanHeadingString(text) {
    return text.replace(/^#{1,6}\s+/, "")
               .replace(/::\s*[^:\n]*(?:::)?/g, "")
               .trim();
}

function cleanCommentTags(line) {
    return line.replace(/%%[\s\S]*?%%/g, "")
               .replace(/%[^\n]*/g, "")
               .trimEnd();
}

function extractLegacyBadgeInfo(line, baseDate) {
    let interval = null;
    let targetDate = null;
    let origDate = null;
    let isOptional = /\[(?:<span[^>]*>)?\°(?:\s*<\/span>)?\]\{Optional\}/i.test(line) || /::\s*optional\b/i.test(line);

    const badgeMatchQ = line.match(/\[(?:<span[^>]*>)?\?(?:\s*<\/span>)?\]\{([\s\S]*?)\}/);
    if (badgeMatchQ) {
        const linesQ = badgeMatchQ[1].split(/<br\s*\/?>/i);
        if (linesQ.length >= 2) {
            const dateOnlyText = linesQ[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const parsed = parseNaturalDate(dateOnlyText, baseDate);
            if (parsed) origDate = parsed.date;
        }
    }

    const badgeMatch = line.match(/\[(?:<span[^>]*>)?\#(?:\s*<\/span>)?\]\{([\s\S]*?)\}/);
    if (badgeMatch) {
        const dataText = badgeMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const repeatMatch = dataText.match(/Repeat:\s*(.*?)(?:Next Occurence:|$)/i);
        if (repeatMatch) {
            interval = parseInterval(repeatMatch[1]);
        }
        const nextMatch = dataText.match(/Next Occurence:\s*(.*?)(?:\(in\s+\d+\s+days?\)|$)/i);
        if (nextMatch) {
            const parsed = parseNaturalDate(nextMatch[1], baseDate);
            if (parsed) targetDate = parsed.date;
        }
    }

    if (interval || targetDate || isOptional || origDate) {
        return {
            repeat: interval ? formatRepeatUnits(interval) : null,
            next: targetDate ? targetDate.format("YYYY-MM-DD") : null,
            orig: origDate ? origDate.format("YYYY-MM-DD") : null,
            isOptional: isOptional
        };
    }
    return null;
}

function parseNoteDateFlexible(name) {
    if (!name) return window.moment();
    const clean = name.replace(/\[|\]/g, "").trim();
    const formats = [
        "Do [of] MMM, YYYY", "Do of MMM, YYYY", "D MMM YYYY", "Do MMMM YYYY",
        "YYYY-MM-DD", "DD-MM-YYYY", "YYYY/MM/DD", "MM-DD-YYYY"
    ];
    for (const f of formats) {
        const m = window.moment(clean, f, true);
        if (m.isValid()) return m;
    }
    const loose = window.moment(clean, formats);
    return loose.isValid() ? loose : window.moment();
}

function parseNoteDateStrict(name) {
    if (!name) return null;
    const clean = name.replace(/\[|\]/g, "").trim();
    const formats = [
        "Do [of] MMM, YYYY", "Do of MMM, YYYY", "D MMM YYYY", "Do MMMM YYYY",
        "YYYY-MM-DD", "DD-MM-YYYY", "YYYY/MM/DD", "MM-DD-YYYY"
    ];
    for (const f of formats) {
        const m = window.moment(clean, f, true);
        if (m.isValid()) return m;
    }
    return null;
}

function isPeriodicOrDailyNote(file, app, folderOverride) {
    if (!file) return false;
    const baseName = file.basename;
    const fileFolder = file.parent ? file.parent.path.replace(/^\/|\/$/g, "") : "";

    if (folderOverride) {
        const folder = folderOverride.replace(/^\/|\/$/g, "");
        if (folder && fileFolder === folder && parseNoteDateStrict(baseName)) return true;
    }

    const dailyCore = app.internalPlugins?.plugins?.["daily-notes"];
    if (dailyCore && dailyCore.enabled) {
        const folder = (dailyCore.instance?.options?.folder || "").replace(/^\/|\/$/g, "");
        if ((!folder || fileFolder === folder) && parseNoteDateStrict(baseName)) return true;
    }

    const periodic = app.plugins?.plugins?.["periodic-notes"];
    if (periodic && periodic.settings) {
        for (const p of ["daily", "weekly", "monthly", "quarterly", "yearly"]) {
            const conf = periodic.settings[p];
            if (conf && conf.enabled) {
                const folder = (conf.folder || "").replace(/^\/|\/$/g, "");
                if (!folder || fileFolder === folder) return true;
            }
        }
    }
    return false;
}

function collectDomAncestorTaskTexts(container) {
    const texts = [];
    if (!container || container.tagName !== "LI") return texts;
    let cur = container.parentElement ? container.parentElement.closest("li") : null;
    while (cur) {
        texts.push(cleanTaskString(extractDirectTextContent(cur)));
        cur = cur.parentElement ? cur.parentElement.closest("li") : null;
    }
    return texts;
}

function isTaskOverdue(data, noteDate) {
    if (!data || !data.next) return false;
    if (data.repeat && /every\s+day|daily/i.test(data.repeat)) return false;
    const nextM = window.moment(data.next, "YYYY-MM-DD");
    return nextM.isValid() && nextM.isBefore(noteDate, 'day');
}

function extractDirectTextContent(element) {
    let text = "";
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE && !['UL', 'OL'].includes(child.tagName)) {
            if (!child.classList.contains("task-progress-badge") && !child.classList.contains("task-custom-tooltip")) {
                text += child.textContent;
            }
        }
    }
    return text.trim();
}

function createTagDecorationExtension(plugin) {
    const decorator = new MatchDecorator({
        regexp: /(?<=^|\s)::[^\n]*/g,
        decoration: (match, view, pos) => {
            const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file || !isPeriodicOrDailyNote(activeView.file, plugin.app, plugin.store.settings.folderOverride)) {
                return null;
            }
            const line = view.state.doc.lineAt(pos);
            const lineText = line.text;
            if (!/^\s*-\s*\[.\]/.test(lineText) && !/^#{1,6}\s+/.test(lineText)) {
                return null;
            }
            const beforeMatch = lineText.substring(0, pos - line.from);
            const backtickCount = (beforeMatch.match(/`/g) || []).length;
            if (backtickCount % 2 !== 0) {
                return null;
            }
            return Decoration.mark({
                class: "task-inline-tag-preview"
            });
        }
    });

    return ViewPlugin.fromClass(
        class {
            constructor(view) {
                this.decorations = decorator.createDeco(view);
            }
            update(update) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = decorator.updateDeco(update, this.decorations);
                }
            }
        },
        {
            decorations: (v) => v.decorations
        }
    );
}

class ProgressWidget extends WidgetType {
    constructor(percent, completed, total) {
        super();
        this.percent = percent;
        this.completed = completed;
        this.total = total;
    }

    toDOM() {
        const badge = document.createElement("span");
        badge.className = "task-progress-badge";

        const circumference = 2 * Math.PI * 5.5;
        const strokeDash = (this.percent / 100) * circumference;

        badge.innerHTML = `
            <svg class="task-progress-ring" viewBox="0 0 16 16">
                <circle class="task-progress-ring-bg" cx="8" cy="8" r="5.5"></circle>
                <circle class="task-progress-ring-fill ${this.percent === 100 ? 'complete' : ''}" cx="8" cy="8" r="5.5" stroke-dasharray="${strokeDash} ${circumference}"></circle>
            </svg>
            <span class="task-progress-count">${this.percent}% (${this.completed}/${this.total})</span>
        `;
        return badge;
    }

    eq(other) {
        return other.percent === this.percent && other.completed === this.completed && other.total === this.total;
    }
}

function createLivePreviewProgressExtension(plugin) {
    return ViewPlugin.fromClass(
        class {
            constructor(view) {
                this.decorations = this.buildDeco(view);
            }
            update(update) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDeco(update.view);
                }
            }
            buildDeco(view) {
                const doc = view.state.doc;
                const decos = [];
                const lineCount = doc.lines;
                const lineData = [];

                const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
                const fileKey = (activeView && activeView.file) ? activeView.file.basename : "";
                const noteDate = fileKey ? parseNoteDateFlexible(fileKey) : null;

                for (let i = 1; i <= lineCount; i++) {
                    const line = doc.line(i);
                    const text = line.text;
                    const isTask = /^\s*-\s*\[.\]/.test(text);
                    const isChecked = /^\s*-\s*\[x\]/i.test(text);
                    const indentMatch = text.match(/^(\s*)/);
                    const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

                    let isOptional = /::\s*optional\b/i.test(text);
                    let isOverdue = false;
                    if (isTask && fileKey && !isChecked) {
                        const cleanText = cleanTaskString(text);
                        const data = plugin.getTaskData(fileKey, cleanText);
                        if (data && data.isOptional) isOptional = true;
                        if (data && isTaskOverdue(data, noteDate)) isOverdue = true;
                    }

                    lineData.push({ lineNum: i, from: line.from, to: line.to, text, isTask, isOptional, isOverdue, isChecked, indent });
                }

                for (let i = 0; i < lineData.length; i++) {
                    const item = lineData[i];
                    if (!item.isTask) continue;

                    let total = 0;
                    let completed = 0;
                    let directIndent = -1;

                    for (let j = i + 1; j < lineData.length; j++) {
                        const child = lineData[j];
                        if (child.indent <= item.indent) break;
                        if (!child.isTask) continue;

                        if (directIndent === -1) {
                            directIndent = child.indent;
                        }

                        if (child.indent === directIndent && !child.isOptional) {
                            total++;
                            if (child.isChecked) completed++;
                        }
                    }

                    if (total > 0) {
                        const percent = Math.round((completed / total) * 100);
                        decos.push(Decoration.widget({
                            widget: new ProgressWidget(percent, completed, total),
                            side: 1
                        }).range(item.to));

                        if (item.indent === 0) {
                            decos.push(Decoration.line({
                                class: "task-top-parent-goal"
                            }).range(item.from));
                        }
                    }

                    if (item.isOptional) {
                        decos.push(Decoration.line({
                            class: "task-optional-item"
                        }).range(item.from));
                    }

                    if (item.isOverdue) {
                        decos.push(Decoration.line({
                            class: "task-overdue-item"
                        }).range(item.from));
                    }
                }

                return Decoration.set(decos, true);
            }
        },
        {
            decorations: (v) => v.decorations
        }
    );
}

class TooltipManager {
    constructor() {
        this.tooltipEl = document.createElement("div");
        this.tooltipEl.className = "task-custom-tooltip";
        document.body.appendChild(this.tooltipEl);
        this.hideTimeout = null;
    }

    showTask(targetEl, data, noteDate) {
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        const refDate = noteDate ? noteDate.clone() : window.moment();
        let html = "";

        if (data.repeat) {
            html += `
                <div class="task-tooltip-section">
                    <div class="task-tooltip-label">repeat:</div>
                    <div class="task-tooltip-value">${data.repeat}</div>
                </div>
            `;
        }

        if (data.next) {
            const nextM = window.moment(data.next, "YYYY-MM-DD");
            if (nextM.isValid()) {
                const dateFormatted = formatOrdinalDate(nextM);
                const rel = formatCompoundRelativeDiff(nextM, refDate);
                html += `
                    <div class="task-tooltip-section">
                        <div class="task-tooltip-label">next occurence:</div>
                        <div class="task-tooltip-value">${dateFormatted}<br><span class="task-tooltip-diff">${rel}</span></div>
                    </div>
                `;
            }
        }

        if (data.orig) {
            const origM = window.moment(data.orig, "YYYY-MM-DD");
            if (origM.isValid()) {
                const dateFormatted = formatOrdinalDate(origM);
                const rel = formatCompoundRelativeDiff(origM, refDate);
                html += `
                    <div class="task-tooltip-section">
                        <div class="task-tooltip-label">originally defined:</div>
                        <div class="task-tooltip-value">${dateFormatted}<br><span class="task-tooltip-diff">${rel}</span></div>
                    </div>
                `;
            }
        }

        if (data.streak) {
            html += `
                <div class="task-tooltip-section">
                    <div class="task-tooltip-label">streak:</div>
                    <div class="task-tooltip-value">${data.streak} day${data.streak === 1 ? "" : "s"}</div>
                </div>
            `;
        }

        if (data.isOptional) {
            html += `
                <div class="task-tooltip-section">
                    <div class="task-tooltip-label">status:</div>
                    <div class="task-tooltip-value">optional</div>
                </div>
            `;
        }

        this.renderTooltip(targetEl, html);
    }

    showHeading(targetEl, type) {
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        const displayType = type === "tasks" ? "today's tasks" : "planned tasks";
        const html = `
            <div class="task-tooltip-section">
                <div class="task-tooltip-label">section type:</div>
                <div class="task-tooltip-value">${displayType}</div>
            </div>
        `;
        this.renderTooltip(targetEl, html);
    }

    renderTooltip(targetEl, html) {
        this.tooltipEl.innerHTML = html;
        this.tooltipEl.classList.add("visible");

        const rect = targetEl.getBoundingClientRect();
        const tooltipRect = this.tooltipEl.getBoundingClientRect();

        let top = rect.top - tooltipRect.height - 8;
        let left = rect.left;

        if (top < 10) {
            top = rect.bottom + 8;
        }
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        this.tooltipEl.style.top = `${top}px`;
        this.tooltipEl.style.left = `${left}px`;
    }

    hide() {
        this.hideTimeout = setTimeout(() => {
            this.tooltipEl.classList.remove("visible");
        }, 80);
    }

    destroy() {
        if (this.tooltipEl && this.tooltipEl.parentNode) {
            this.tooltipEl.parentNode.removeChild(this.tooltipEl);
        }
    }
}

class DailyTasksSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Daily Tasks Configuration" });

        new Setting(containerEl)
            .setName("Daily Notes Folder Override")
            .setDesc("Restrict scheduling/rollover to notes in this folder specifically. Leave blank to use whatever Obsidian's core Daily Notes plugin (or Periodic Notes) is configured with. Set this if you don't use either of those, or want to be extra sure random notes elsewhere in your vault never get treated as a daily note.")
            .addText((text) => {
                text.setPlaceholder("e.g. Daily Notes")
                    .setValue(this.plugin.store.settings.folderOverride || "")
                    .onChange(async (value) => {
                        this.plugin.store.settings.folderOverride = value.trim();
                        await this.plugin.saveData(this.plugin.store);
                    });
            });

        new Setting(containerEl)
            .setName("Open Data File")
            .setDesc("Open or reveal the plugin data.json file where task and heading metadata is stored.")
            .addButton((btn) => {
                btn.setButtonText("Open data.json").onClick(async () => {
                    const dataPath = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/data.json`);
                    const exists = await this.app.vault.adapter.exists(dataPath);
                    if (!exists) {
                        await this.plugin.saveData(this.plugin.store);
                    }
                    const fullPath = this.app.vault.adapter.getFullPath(dataPath);
                    if (window.require) {
                        const { shell } = window.require("electron");
                        shell.showItemInFolder(fullPath);
                    } else {
                        new Notice(`data.json path: ${dataPath}`);
                    }
                });
            });

        new Setting(containerEl)
            .setName("Clear All Stored Tasks")
            .setDesc("Permanently wipe all scheduled task metadata and heading mappings across all notes.")
            .addButton((btn) => {
                btn.setButtonText("Clear Everything")
                   .setClass("daily-tasks-settings-btn-danger")
                   .onClick(async () => {
                       this.plugin.store = { tasks: {}, headings: {}, settings: this.plugin.store.settings || {} };
                       await this.plugin.saveData(this.plugin.store);
                       new Notice("All Daily Tasks schedule data cleared.");
                   });
            });
    }
}

class TasksTemplateApi {
    constructor(plugin) {
        this.plugin = plugin;
    }

    async now(tp) {
        const title = (tp && tp.file && typeof tp.file.title === "string") ? tp.file.title : undefined;
        return await this.plugin.getRolloverContent("tasks", title).catch(() => "- [ ] ");
    }

    async planned(tp) {
        const title = (tp && tp.file && typeof tp.file.title === "string") ? tp.file.title : undefined;
        return await this.plugin.getRolloverContent("plan", title).catch(() => "- [ ] ");
    }
}

module.exports = class DailyTasksPlugin extends Plugin {
    async onload() {
        const loaded = await this.loadData();
        this.store = loaded && (loaded.tasks || loaded.headings || loaded.settings) ? loaded : { tasks: loaded || {}, headings: {}, settings: {} };
        if (!this.store.tasks) this.store.tasks = {};
        if (!this.store.headings) this.store.headings = {};
        if (!this.store.settings) this.store.settings = {};
        if (!("folderOverride" in this.store.settings)) this.store.settings.folderOverride = "";

        this.tooltipManager = new TooltipManager();
        this.isAutoUpdatingCheckboxes = false;
        this.scanTimeout = null;

        this.tasksApi = new TasksTemplateApi(this);
        window.tasks = this.tasksApi;
        window.TaskSchedulerAPI = this;

        this.addSettingTab(new DailyTasksSettingTab(this.app, this));

        const templaterEnabled = !!this.app.plugins?.plugins?.["templater-obsidian"];
        if (!templaterEnabled) {
            new Notice("Daily Tasks: Templater isn't enabled. Task rollover (tasks.now / tasks.planned) won't run without it - install/enable the Templater plugin.", 10000);
        }

        this.registerEditorExtension(createTagDecorationExtension(this));
        this.registerEditorExtension(createLivePreviewProgressExtension(this));

        this.registerMarkdownPostProcessor((element, ctx) => {
            this.processProgressBars(element, ctx.sourcePath);
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!file || !isPeriodicOrDailyNote(file, this.app, this.store.settings.folderOverride)) return;
                menu.addItem((item) => {
                    item.setTitle("Clear Scheduled Tasks")
                        .setIcon("trash")
                        .onClick(async () => {
                            const fileKey = file.basename;
                            if (this.store.tasks[fileKey]) {
                                delete this.store.tasks[fileKey];
                            }
                            if (this.store.headings[fileKey]) {
                                delete this.store.headings[fileKey];
                            }
                            await this.saveData(this.store);
                            new Notice(`Cleared data for ${fileKey}`);
                        });
                });
            })
        );

        this.registerDomEvent(document, "mouseover", (evt) => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file) return;
            if (!isPeriodicOrDailyNote(activeView.file, this.app, this.store.settings.folderOverride)) return;

            const fileKey = activeView.file.basename;
            const noteDate = parseNoteDateFlexible(fileKey);

            const headingEl = evt.target.closest("h1, h2, h3, h4, h5, h6, .HyperMD-header");
            if (headingEl) {
                const headingText = cleanHeadingString(headingEl.textContent || "");
                const hType = this.getHeadingType(fileKey, headingText);
                if (hType) {
                    headingEl.classList.add("heading-has-type");
                    this.tooltipManager.showHeading(headingEl, hType);
                    return;
                }
            }

            const checkbox = evt.target.closest('input[type="checkbox"], .task-list-item-checkbox, .cm-formatting-task');
            if (!checkbox) return;

            let cleanText = "";
            let ancestorCleanTexts = [];

            const cmView = activeView.editor && activeView.editor.cm;
            if (cmView && typeof cmView.posAtDOM === "function") {
                try {
                    const pos = cmView.posAtDOM(checkbox);
                    const lineNum = cmView.state.doc.lineAt(pos).number - 1;
                    const line = activeView.editor.getLine(lineNum);
                    cleanText = cleanTaskString(line);

                    let currentIndent = (line.match(/^(\s*)/)[1] || "").replace(/\t/g, "    ").length;
                    if (currentIndent > 0) {
                        for (let p = lineNum - 1; p >= 0; p--) {
                            const pLine = activeView.editor.getLine(p);
                            if (/^\s*-\s*\[.\]/.test(pLine)) {
                                const pIndent = (pLine.match(/^(\s*)/)[1] || "").replace(/\t/g, "    ").length;
                                if (pIndent < currentIndent) {
                                    ancestorCleanTexts.push(cleanTaskString(pLine));
                                    currentIndent = pIndent;
                                    if (currentIndent === 0) break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    const container = checkbox.closest("li, .cm-line");
                    cleanText = cleanTaskString(container ? extractDirectTextContent(container) : "");
                    ancestorCleanTexts = collectDomAncestorTaskTexts(container);
                }
            } else {
                const container = checkbox.closest("li, .cm-line");
                cleanText = cleanTaskString(container ? extractDirectTextContent(container) : "");
                ancestorCleanTexts = collectDomAncestorTaskTexts(container);
            }

            if (!cleanText) return;

            let data = this.getTaskData(fileKey, cleanText);
            if (!data) {
                for (const ancestorText of ancestorCleanTexts) {
                    data = this.getTaskData(fileKey, ancestorText);
                    if (data) break;
                }
            }

            if (data && (data.repeat || data.next || data.orig || data.isOptional)) {
                checkbox.classList.add("task-has-schedule");
                this.tooltipManager.showTask(checkbox, data, noteDate);
            }
        });

        this.registerDomEvent(document, "mouseout", (evt) => {
            const target = evt.target.closest('input[type="checkbox"], .task-list-item-checkbox, .cm-formatting-task, h1, h2, h3, h4, h5, h6, .HyperMD-header');
            if (target) {
                this.tooltipManager.hide();
            }
        });

        this.registerEvent(
            this.app.workspace.on("editor-change", async (editor) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView || !activeView.file) return;
                if (!isPeriodicOrDailyNote(activeView.file, this.app, this.store.settings.folderOverride)) return;

                if (!this.isAutoUpdatingCheckboxes) {
                    this.autoCheckParentTasks(editor, activeView.file.basename);
                }

                this.requestScan(editor, activeView.file.basename);
            })
        );

        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (!file || !isPeriodicOrDailyNote(file, this.app, this.store.settings.folderOverride)) return;
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView && activeView.editor) {
                    this.requestScan(activeView.editor, file.basename);
                }
            })
        );
    }

    requestScan(editor, fileKey) {
        if (this.scanTimeout) clearTimeout(this.scanTimeout);
        this.scanTimeout = setTimeout(async () => {
            await this.scanAndProcessDocument(editor, fileKey);
        }, 400);
    }

    async scanAndProcessDocument(editor, fileKey) {
        const lineCount = editor.lineCount();
        const noteDate = parseNoteDateFlexible(fileKey);
        const updates = [];

        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            const isTask = /^\s*-\s*\[.\]/.test(line);
            const isHeading = /^#{1,6}\s+/.test(line);

            if (!isTask && !isHeading) continue;

            const match = line.match(/(?:::|\s::)\s*([^:\n]+)\s*::$/);
            if (match) {
                const rawTag = match[1].trim();
                const cleanLine = line.replace(/(?:::|\s::)\s*([^:\n]+)\s*::$/, "").trimEnd();
                updates.push({ lineNum: i, newText: cleanLine, rawTag, isHeading, isTask });
            }
        }

        if (updates.length > 0) {
            for (const u of updates) {
                if (u.isHeading) {
                    const headingText = cleanHeadingString(u.newText);
                    if (/^(clear|remove|delete|none|reset)$/i.test(u.rawTag)) {
                        await this.deleteHeadingType(fileKey, headingText);
                    } else {
                        const headingType = this.normalizeHeadingType(u.rawTag);
                        if (headingType) await this.saveHeadingType(fileKey, headingText, headingType);
                    }
                } else if (u.isTask) {
                    const cleanText = cleanTaskString(u.newText);
                    const existing = this.getTaskData(fileKey, cleanText) || {};
                    const parsed = parseTaskTag(u.rawTag, noteDate, existing);

                    if (parsed.isClear) {
                        await this.deleteTaskData(fileKey, cleanText);
                    } else {
                        let repeat = parsed.explicitRepeat !== null ? parsed.explicitRepeat : (existing.repeat || null);
                        let orig = parsed.explicitOrigDate ? parsed.explicitOrigDate.format("YYYY-MM-DD") : (existing.orig || null);
                        let start = parsed.explicitStartDate ? parsed.explicitStartDate.format("YYYY-MM-DD") : (existing.start || null);
                        let isOptional = parsed.hasExplicitOptional ? parsed.isOptional : (existing.isOptional || false);
                        let streak = existing.streak || 0;

                        let nextStr = null;
                        if (parsed.explicitNextDate) {
                            nextStr = parsed.explicitNextDate.format("YYYY-MM-DD");
                        } else if (existing.next && !parsed.explicitRepeat) {
                            nextStr = existing.next;
                        } else if (parsed.explicitInterval) {
                            if (parsed.explicitInterval.days === 1 && !parsed.explicitInterval.weeks && !parsed.explicitInterval.months && !parsed.explicitInterval.years) {
                                nextStr = noteDate.clone().add(1, "days").format("YYYY-MM-DD");
                            } else {
                                nextStr = addToDate(noteDate, parsed.explicitInterval).format("YYYY-MM-DD");
                            }
                        }

                        await this.saveTaskData(fileKey, cleanText, {
                            repeat,
                            next: nextStr,
                            orig,
                            start,
                            isOptional,
                            streak,
                            rawTag: u.rawTag
                        });
                    }
                }
                editor.setLine(u.lineNum, u.newText);
            }
        }
    }

    autoCheckParentTasks(editor, fileKey) {
        const lineCount = editor.lineCount();
        const lines = [];
        for (let i = 0; i < lineCount; i++) {
            const text = editor.getLine(i);
            const isTask = /^\s*-\s*\[.\]/.test(text);
            const isChecked = /^\s*-\s*\[x\]/i.test(text);
            const indentMatch = text.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

            let isOptional = false;
            if (isTask) {
                const data = this.getTaskData(fileKey, cleanTaskString(text));
                if (data && data.isOptional) isOptional = true;
            }

            lines.push({ lineNum: i, text, isTask, isOptional, isChecked, indent });
        }

        const updates = [];

        for (let i = 0; i < lines.length; i++) {
            const parent = lines[i];
            if (!parent.isTask) continue;

            let total = 0;
            let completed = 0;
            let directIndent = -1;

            for (let j = i + 1; j < lines.length; j++) {
                const child = lines[j];
                if (child.indent <= parent.indent) break;
                if (!child.isTask) continue;

                if (directIndent === -1) {
                    directIndent = child.indent;
                }

                if (child.indent === directIndent && !child.isOptional) {
                    total++;
                    if (child.isChecked) completed++;
                }
            }

            if (total > 0) {
                const shouldBeChecked = (completed === total);
                if (shouldBeChecked && !parent.isChecked) {
                    const newText = parent.text.replace(/^(\s*-\s*\[).(\])/, "$1x$2");
                    updates.push({ lineNum: parent.lineNum, newText });
                } else if (!shouldBeChecked && parent.isChecked) {
                    const newText = parent.text.replace(/^(\s*-\s*\[).(\])/, "$1 $2");
                    updates.push({ lineNum: parent.lineNum, newText });
                }
            }
        }

        if (updates.length > 0) {
            this.isAutoUpdatingCheckboxes = true;
            for (const u of updates) {
                editor.setLine(u.lineNum, u.newText);
            }
            this.isAutoUpdatingCheckboxes = false;
        }
    }

    processProgressBars(container, sourcePath) {
        let fileKey = sourcePath ? sourcePath.split("/").pop().replace(".md", "") : "";

        if (fileKey) {
            const noteDate = parseNoteDateFlexible(fileKey);
            const allLis = container.querySelectorAll("li");
            for (const li of allLis) {
                const cb = li.querySelector(':scope > input[type="checkbox"]');
                if (!cb || cb.checked) continue;
                const data = this.getTaskData(fileKey, cleanTaskString(extractDirectTextContent(li)));
                if (data && isTaskOverdue(data, noteDate)) {
                    li.classList.add("task-overdue-item");
                }
            }
        }

        const listItems = container.querySelectorAll("li");
        for (const li of listItems) {
            const nestedUl = li.querySelector(":scope > ul, :scope > ol");
            if (!nestedUl) continue;

            const childLis = nestedUl.querySelectorAll(":scope > li");
            let total = 0;
            let completed = 0;

            for (const cLi of childLis) {
                let isOptional = false;
                if (fileKey) {
                    const data = this.getTaskData(fileKey, cleanTaskString(extractDirectTextContent(cLi)));
                    if (data && data.isOptional) isOptional = true;
                }

                const cb = cLi.querySelector('input[type="checkbox"]');
                if (cb && !isOptional) {
                    total++;
                    if (cb.checked) completed++;
                }
                if (isOptional) {
                    cLi.classList.add("task-optional-item");
                }
            }

            if (total === 0) continue;
            const percent = Math.round((completed / total) * 100);

            const existingBadge = li.querySelector(":scope > .task-progress-badge");
            if (existingBadge) existingBadge.remove();

            const badge = document.createElement("span");
            badge.className = "task-progress-badge";

            const circumference = 2 * Math.PI * 5.5;
            const strokeDash = (percent / 100) * circumference;

            badge.innerHTML = `
                <svg class="task-progress-ring" viewBox="0 0 16 16">
                    <circle class="task-progress-ring-bg" cx="8" cy="8" r="5.5"></circle>
                    <circle class="task-progress-ring-fill ${percent === 100 ? 'complete' : ''}" cx="8" cy="8" r="5.5" stroke-dasharray="${strokeDash} ${circumference}"></circle>
                </svg>
                <span class="task-progress-count">${percent}% (${completed}/${total})</span>
            `;

            const isTopLevel = !li.parentElement.closest("li");
            const firstP = li.querySelector(":scope > p, :scope > span") || li.childNodes[0];
            if (firstP && firstP.nodeType === Node.TEXT_NODE) {
                const wrapper = document.createElement("span");
                if (isTopLevel) wrapper.className = "task-top-parent-goal";
                li.insertBefore(wrapper, firstP);
                wrapper.appendChild(firstP);
                wrapper.insertAdjacentElement("afterend", badge);
            } else if (firstP && firstP.nodeType === Node.ELEMENT_NODE) {
                if (isTopLevel) firstP.classList.add("task-top-parent-goal");
                firstP.insertAdjacentElement("afterend", badge);
            } else {
                li.appendChild(badge);
            }
        }
    }

    normalizeHeadingType(tag) {
        const lower = tag.toLowerCase().trim();
        if (/^(tasks?|today|today'?s?\s*tasks?|current|inbox)$/i.test(lower)) return "tasks";
        if (/^(plans?|planned|planned\s*tasks?|future|queue|later)$/i.test(lower)) return "plan";
        return null;
    }

    async saveHeadingType(fileKey, headingText, type) {
        if (!this.store.headings) this.store.headings = {};
        if (!this.store.headings[fileKey]) this.store.headings[fileKey] = {};
        this.store.headings[fileKey][headingText.toLowerCase()] = type;
        await this.saveData(this.store);
    }

    async deleteHeadingType(fileKey, headingText) {
        const h = headingText.toLowerCase();
        if (this.store.headings && this.store.headings[fileKey] && this.store.headings[fileKey][h]) {
            delete this.store.headings[fileKey][h];
            await this.saveData(this.store);
        }
    }

    getHeadingType(fileKey, headingText) {
        const h = headingText.toLowerCase();
        if (this.store.headings && this.store.headings[fileKey] && this.store.headings[fileKey][h]) {
            return this.store.headings[fileKey][h];
        }
        if (this.store.headings) {
            for (const f of Object.keys(this.store.headings)) {
                if (this.store.headings[f] && this.store.headings[f][h]) return this.store.headings[f][h];
            }
        }
        return null;
    }

    async saveTaskData(fileKey, taskText, data) {
        if (!this.store.tasks) this.store.tasks = {};
        if (!this.store.tasks[fileKey]) this.store.tasks[fileKey] = {};
        this.store.tasks[fileKey][taskText] = data;
        await this.saveData(this.store);
    }

    async deleteTaskData(fileKey, taskText) {
        if (this.store.tasks && this.store.tasks[fileKey] && this.store.tasks[fileKey][taskText]) {
            delete this.store.tasks[fileKey][taskText];
        }
        if (this.store.tasks) {
            for (const f of Object.keys(this.store.tasks)) {
                if (this.store.tasks[f] && this.store.tasks[f][taskText]) {
                    delete this.store.tasks[f][taskText];
                }
            }
        }
        await this.saveData(this.store);
    }

    getTaskData(fileKey, taskText) {
        const noteDate = parseNoteDateFlexible(fileKey);
        if (this.store.tasks && this.store.tasks[fileKey] && this.store.tasks[fileKey][taskText]) {
            const currentData = this.store.tasks[fileKey][taskText];
            if (currentData.repeat && /every\s+day|daily/i.test(currentData.repeat)) {
                const nextStr = noteDate.clone().add(1, 'days').format("YYYY-MM-DD");
                return { ...currentData, next: nextStr };
            }
            return currentData;
        }

        if (this.store.tasks) {
            const sortedFiles = Object.keys(this.store.tasks)
                .map(f => ({ name: f, date: parseNoteDateFlexible(f) }))
                .filter(f => f.date.isValid() && f.date.isSameOrBefore(noteDate, 'day'))
                .sort((a, b) => b.date.valueOf() - a.date.valueOf());

            for (const item of sortedFiles) {
                const map = this.store.tasks[item.name];
                if (map && map[taskText]) {
                    const inherited = { ...map[taskText] };
                    if (inherited.repeat && /every\s+day|daily/i.test(inherited.repeat)) {
                        inherited.next = noteDate.clone().add(1, 'days').format("YYYY-MM-DD");
                    }
                    this.saveTaskData(fileKey, taskText, inherited);
                    return inherited;
                }
            }
        }
        return null;
    }

    buildTaskTree(lines) {
        const root = [];
        const stack = [];

        for (const line of lines) {
            if (!line.trim()) continue;
            const indentMatch = line.match(/^(\s*)/);
            const indentStr = indentMatch ? indentMatch[1] : "";
            const indentLevel = indentStr.replace(/\t/g, "    ").length;

            const isTask = /^\s*-\s*\[.\]/.test(line);
            const item = {
                raw: line,
                isTask,
                indentLevel,
                children: []
            };

            while (stack.length > 0 && stack[stack.length - 1].indentLevel >= indentLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                root.push(item);
            } else {
                stack[stack.length - 1].children.push(item);
            }

            stack.push(item);
        }

        return root;
    }

    formatTaskTree(item, uncheckAll) {
        const out = [];
        let line = item.raw;
        if (uncheckAll && item.isTask) {
            line = line.replace(/(\[).(\])/, "$1 $2");
        }
        line = cleanCommentTags(line);
        line = line.replace(/\[(?:<span[^>]*>)?[\?\#\°](?:\s*<\/span>)?\]\{[\s\S]*?\}\s*/g, "");
        line = line.replace(/\{#\|[^}]+\}\s*/g, "");
        line = line.replace(/::\s*[^:\n]*(?:::)?/g, "").trimEnd();

        out.push(line);
        for (const child of item.children) {
            out.push(...this.formatTaskTree(child, uncheckAll));
        }
        return out;
    }

    filterTreeBySchedule(item, currentNoteTitle, prevNoteTitle, parentSchedule) {
        const noteDate = parseNoteDateFlexible(currentNoteTitle);
        const cleanText = cleanTaskString(item.raw);

        let data = this.getTaskData(prevNoteTitle, cleanText);
        if (!data && parentSchedule) {
            data = parentSchedule;
        }

        let isDueToday = true;
        if (data) {
            const interval = data.repeat ? parseInterval(data.repeat) : null;
            const isDaily = interval && interval.days === 1 && !interval.weeks && !interval.months && !interval.years;
            if (isDaily) {
                data = { ...data, next: noteDate.clone().add(1, 'days').format("YYYY-MM-DD") };
            }
            this.saveTaskData(currentNoteTitle, cleanText, data);
            if (data.next) {
                const nextM = window.moment(data.next, "YYYY-MM-DD");
                isDueToday = nextM.isSameOrBefore(noteDate, 'day');
            }
        }

        const filteredChildren = [];
        for (const child of item.children) {
            const childResult = this.filterTreeBySchedule(child, currentNoteTitle, prevNoteTitle, data);
            if (childResult) filteredChildren.push(childResult);
        }

        return {
            ...item,
            data,
            isDueToday,
            children: filteredChildren
        };
    }

    evaluateRollover(prevNoteTitle, currentNoteTitle, prevLines) {
        const prevNoteDate = parseNoteDateFlexible(prevNoteTitle);
        const noteDate = parseNoteDateFlexible(currentNoteTitle);

        const tree = this.buildTaskTree(prevLines);
        const todayTasks = [];
        const plannedTasks = [];

        for (const rootItem of tree) {
            const rawLine = rootItem.raw;
            if (!rootItem.isTask) continue;

            const cleanText = cleanTaskString(rawLine);
            let data = this.getTaskData(prevNoteTitle, cleanText);
            if (!data) {
                data = extractLegacyBadgeInfo(rawLine, prevNoteDate);
            }

            const processedTree = this.filterTreeBySchedule(rootItem, currentNoteTitle, prevNoteTitle, null);
            const isChecked = /^\s*-\s*\[x\]/i.test(rawLine);

            if (!data) {
                if (!isChecked) {
                    todayTasks.push(...this.formatTaskTree(processedTree, false));
                }
                continue;
            }

            const interval = data.repeat ? parseInterval(data.repeat) : null;
            let targetDate = data.next ? window.moment(data.next, "YYYY-MM-DD") : null;
            const startDate = data.start ? window.moment(data.start, "YYYY-MM-DD") : null;

            const isDaily = interval && interval.days === 1 && !interval.weeks && !interval.months && !interval.years;

            if (isDaily) {
                const newStreak = isChecked ? (data.streak || 0) + 1 : 0;
                todayTasks.push(...this.formatTaskTree(processedTree, true));
                this.saveTaskData(currentNoteTitle, cleanText, {
                    ...data,
                    next: noteDate.clone().add(1, 'days').format("YYYY-MM-DD"),
                    streak: newStreak
                });
                continue;
            }

            if (startDate && noteDate.isBefore(startDate, 'day')) {
                plannedTasks.push(...this.formatTaskTree(processedTree, true));
                this.saveTaskData(currentNoteTitle, cleanText, data);
                continue;
            }

            if (!targetDate && interval) {
                targetDate = addToDate(prevNoteDate, interval);
            }

            if (targetDate) {
                const isDueToday = targetDate.isSameOrBefore(noteDate, 'day');
                if (isDueToday) {
                    todayTasks.push(...this.formatTaskTree(processedTree, true));
                    if (interval) {
                        const nextAfterToday = addToDate(noteDate, interval);
                        this.saveTaskData(currentNoteTitle, cleanText, {
                            ...data,
                            next: nextAfterToday.format("YYYY-MM-DD")
                        });
                    } else {
                        this.saveTaskData(currentNoteTitle, cleanText, data);
                    }
                } else {
                    plannedTasks.push(...this.formatTaskTree(processedTree, true));
                    this.saveTaskData(currentNoteTitle, cleanText, {
                        ...data,
                        next: targetDate.format("YYYY-MM-DD")
                    });
                }
            } else {
                if (!isChecked) {
                    todayTasks.push(...this.formatTaskTree(processedTree, false));
                    this.saveTaskData(currentNoteTitle, cleanText, data);
                }
            }
        }

        return {
            todayTasks: todayTasks.length > 0 ? todayTasks.join("\n") : "- [ ] ",
            plannedTasks: plannedTasks.length > 0 ? plannedTasks.join("\n") : "- [ ] "
        };
    }

    async getRolloverContent(type, tpTitle) {
        let resolvedTitle = tpTitle;
        if (resolvedTitle && typeof resolvedTitle === "object") {
            resolvedTitle = resolvedTitle.file?.title || resolvedTitle.title || null;
        }
        const currentTitle = resolvedTitle || (this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().basename : window.moment().format("YYYY-MM-DD"));
        const noteDate = parseNoteDateFlexible(currentTitle);

        const allFiles = this.app.vault.getMarkdownFiles();
        const dateFiles = [];
        for (const f of allFiles) {
            if (f.basename === currentTitle) continue;
            if (!isPeriodicOrDailyNote(f, this.app, this.store.settings.folderOverride)) continue;
            const m = parseNoteDateFlexible(f.basename);
            if (m.isValid() && m.isBefore(noteDate, 'day')) {
                dateFiles.push({ file: f, date: m });
            }
        }

        dateFiles.sort((a, b) => b.date.valueOf() - a.date.valueOf());
        const prevFile = dateFiles.length > 0 ? dateFiles[0].file : null;

        if (!prevFile) return "- [ ] ";

        const content = await this.app.vault.read(prevFile);
        const cache = this.app.metadataCache.getFileCache(prevFile);
        const lines = content.split("\n");
        const headings = cache ? cache.headings || [] : [];

        const getSectionLines = (hName) => {
            const target = headings.find(h => cleanHeadingString(h.heading).toLowerCase() === hName.toLowerCase());
            if (!target) return [];
            const startLine = target.position.start.line + 1;
            const nextHeader = headings.find(h => h.position.start.line > target.position.start.line);
            const endLine = nextHeader ? nextHeader.position.start.line : lines.length;
            return lines.slice(startLine, endLine);
        };

        let allPreviousTaskLines = [];
        let sectionDetected = false;

        for (const h of headings) {
            const rawH = h.heading;
            const hClean = cleanHeadingString(rawH);

            let hType = this.getHeadingType(prevFile.basename, hClean);

            if (!hType && /::\s*([^:\n]+)\s*::/.test(rawH)) {
                const match = rawH.match(/::\s*([^:\n]+)\s*::/);
                if (match) hType = this.normalizeHeadingType(match[1]);
            }
            if (!hType) {
                if (/today'?s?\s*tasks?/i.test(hClean)) hType = "tasks";
                else if (/planned\s*tasks?/i.test(hClean)) hType = "plan";
            }

            if (hType === "tasks" || hType === "plan") {
                allPreviousTaskLines = allPreviousTaskLines.concat(getSectionLines(hClean));
                sectionDetected = true;
            }
        }

        if (!sectionDetected) {
            allPreviousTaskLines = lines.filter(l => /^\s*-\s*\[.\]/.test(l));
        }

        const rollover = this.evaluateRollover(prevFile.basename, currentTitle, allPreviousTaskLines);
        return type === "tasks" ? rollover.todayTasks : rollover.plannedTasks;
    }

    onunload() {
        if (this.tooltipManager) {
            this.tooltipManager.destroy();
        }
        delete window.tasks;
        delete window.TaskSchedulerAPI;
    }
};