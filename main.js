const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, normalizePath, Modal, editorInfoField } = require("obsidian");
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

const DAILY_REPEAT_RE = /\b(?:every\s+day|daily)\b/i;
const INLINE_OPTIONAL_RE = /::[^:\n]*\boptional\b[^:\n]*::/i;
const TASK_LINE_RE = /^\s*-\s*\[.\]/;
const CHECKED_LINE_RE = /^\s*-\s*\[x\]/i;
const HEADING_LINE_RE = /^#{1,6}\s+/;
const TAG_END_RE = /(?:::|\s::)\s*([^:\n\r]+?)\s*::\s*$/;

function normalizeForMatching(text) {
    if (!text) return "";
    return text.replace(/\[([^\]]+)\]\([^\)]*\)/g, "$1")
               .replace(/\[\[(?:[^\]\|]*\|)?([^\]]+)\]\]/g, "$1")
               .replace(/[\*_~`]/g, "")
               .replace(/\s+/g, " ")
               .trim()
               .toLowerCase();
}

function normalizeNaturalText(str) {
    let s = str.toLowerCase()
        .replace(/[\,]/g, " ")
        .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
        .replace(/\b(st|nd|rd|th)\b/g, " ")
        .replace(/\bof\b/g, " ");

    s = s.replace(/\beveryday\b/g, "every day")
         .replace(/\bevery\s+other\s+day\b/g, "2 days")
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
         .replace(/\b(the\s+day\s+before\s+yesterday)\b/g, "-2 days");

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

    if (/\bdaily\b|\bevery\s+day\b|\beveryday\b/.test(s)) { days += 1; found = true; }
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

function getWeekdayDate(baseDate, targetDayNum, modifier) {
    const d = baseDate.clone();
    const currentDay = d.day();

    if (modifier === "this") {
        if (targetDayNum === currentDay) {
            return d;
        }
        let diff = targetDayNum - currentDay;
        if (diff < 0) diff += 7;
        return d.add(diff, "days");
    }

    if (modifier === "next") {
        let diff = targetDayNum - currentDay;
        if (diff <= 0) {
            diff += 7;
        } else {
            diff += 7;
        }
        return d.add(diff, "days");
    }

    let diff = targetDayNum - currentDay;
    if (diff <= 0) diff += 7;
    return d.add(diff, "days");
}

function parseNaturalDate(rawStr, baseDate) {
    if (!rawStr) return null;
    const s = normalizeNaturalText(rawStr).replace(/^on\s+/i, "").trim();

    if (/\b(?:today|tonight)\b/i.test(s)) {
        return { date: baseDate.clone(), hasYear: true };
    }
    if (/\btomorrow\b/i.test(s)) {
        return { date: baseDate.clone().add(1, "days"), hasYear: true };
    }
    if (/\byesterday\b/i.test(s)) {
        return { date: baseDate.clone().subtract(1, "days"), hasYear: true };
    }

    const formats = [
        "DD/MM/YYYY", "D/M/YYYY", "DD-MM-YYYY", "D-M-YYYY", "D.M.YYYY", "DD.MM.YYYY",
        "YYYY-MM-DD", "YYYY-M-D", "YYYY/MM/DD", "YYYY/M/D", "YYYY.MM.DD", "YYYY.M.D",
        "MM/DD/YYYY", "M/D/YYYY", "MM-DD-YYYY", "M-D-YYYY",
        "D M YYYY", "DD MM YYYY", "YYYY M D", "YYYY MM DD",
        "D MMMM YYYY", "D MMM YYYY", "MMMM D YYYY", "MMM D YYYY",
        "DD/MM", "D/M", "DD-MM", "D-M", "D.M", "DD.MM", "D M", "DD MM",
        "MM/DD", "M/D", "MM-DD", "M-D",
        "D MMMM", "D MMM", "MMMM D", "MMM D"
    ];

    for (const f of formats) {
        const m = window.moment(s, f, true);
        if (m.isValid()) {
            const hasYear = f.includes("Y");
            if (!hasYear) {
                m.year(baseDate.year());
                if (m.isBefore(baseDate, "day")) m.add(1, "year");
            }
            return { date: m, hasYear };
        }
    }

    for (const [dayName, dayNum] of Object.entries(WEEKDAYS)) {
        if (new RegExp(`\\bnext\\s+${dayName}\\b`, "i").test(s)) {
            return { date: getWeekdayDate(baseDate, dayNum, "next"), hasYear: false };
        }
        if (new RegExp(`\\b(?:this|coming)\\s+${dayName}\\b`, "i").test(s)) {
            return { date: getWeekdayDate(baseDate, dayNum, "this"), hasYear: false };
        }
        if (new RegExp(`\\b(?:on\\s+)?${dayName}\\b`, "i").test(s)) {
            return { date: getWeekdayDate(baseDate, dayNum, null), hasYear: false };
        }
    }
    return null;
}

function getWeekdaysFromData(data) {
    if (!data) return null;
    if (data.weekdays && Array.isArray(data.weekdays) && data.weekdays.length > 0) {
        return data.weekdays;
    }
    if (!data.repeat && !/\b(?:every|each|repeat|recurring|repeating)\b/i.test(data.rawTag || "")) {
        return null;
    }
    const text = ((data.repeat || "") + " " + (data.rawTag || "")).toLowerCase();
    const s = normalizeNaturalText(text);
    if (/\b(?:weekdays?|workdays?)\b/.test(s)) return [1, 2, 3, 4, 5];
    if (/\b(?:weekends?)\b/.test(s)) return [0, 6];

    const detected = [];
    for (const word of s.split(/[\s,]+/)) {
        const clean = word.replace(/[^a-z]/g, "");
        if (WEEKDAYS[clean] !== undefined && !detected.includes(WEEKDAYS[clean])) {
            detected.push(WEEKDAYS[clean]);
        }
    }
    return detected.length > 0 ? detected : null;
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

function getNextMatchingWeekdayDate(baseDate, daysArray, startDate = null) {
    let check = startDate && startDate.isAfter(baseDate, "day") ? startDate.clone() : baseDate.clone();
    for (let i = 0; i <= 7; i++) {
        if (daysArray.includes(check.day())) {
            return check;
        }
        check.add(1, "days");
    }
    return baseDate.clone().add(1, "days");
}

function parseTaskTag(tagRaw, baseDate, existingData = null) {
    const raw = tagRaw.trim();
    if (/^(clear|remove|delete|none|reset|cancel|stop)(\s+(schedule|task|repeat|recurrence|all))?$|^no\s+(schedule|repeat|recurrence)$/i.test(raw)) {
        return { isClear: true };
    }

    const rawSegments = raw.split(/(?:&|;\s*|\s+and\s+(?=(?:optional|required|snooze|repeat|every|next|start|from|until)\b))/i)
        .map(s => s.trim())
        .filter(Boolean);

    let isOptional = existingData ? existingData.isOptional : false;
    let explicitNextDate = null;
    let explicitStartDate = null;
    let explicitUntilDate = null;
    let explicitSnoozeDate = null;
    let explicitRepeat = null;
    let explicitInterval = null;
    let explicitOrigDate = null;
    let explicitWeekdays = null;
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

        const recurRangeMatch = segLower.match(/^(.+?)\s+(?:from|in|starting\s+from|starting)\s+(.+?)\s+(?:to|until|til|till|thru|through|up\s*to|-)\s+(.+)$/i);
        if (recurRangeMatch) {
            const rStart = parseNaturalDate(recurRangeMatch[2].trim(), baseDate);
            const rEnd = parseNaturalDate(recurRangeMatch[3].trim(), baseDate);
            if (rStart && rEnd) {
                explicitStartDate = rStart.date.clone();
                explicitUntilDate = rEnd.date.clone();
                if (explicitUntilDate.isBefore(explicitStartDate, "day") && !rEnd.hasYear) {
                    explicitUntilDate.add(1, "year");
                }
                segLower = recurRangeMatch[1].trim();
            }
        }

        let rangeMatch = segLower.match(/^(?:(?:from|in|starting\s+from|starting)\s+)?(.+?)\s+(?:to|until|til|till|thru|through|up\s*to|-)\s+(.+)$/i);
        if (!rangeMatch) {
            rangeMatch = segLower.match(/^between\s+(.+?)\s+(?:and|to)\s+(.+)$/i);
        }

        if (rangeMatch) {
            const rawStart = rangeMatch[1].trim();
            const rawEnd = rangeMatch[2].trim();
            const parsedStart = parseNaturalDate(rawStart, baseDate);
            const parsedEnd = parseNaturalDate(rawEnd, baseDate);

            if (parsedStart && parsedEnd) {
                explicitStartDate = parsedStart.date.clone();
                explicitUntilDate = parsedEnd.date.clone();

                if (explicitUntilDate.isBefore(explicitStartDate, "day")) {
                    if (!parsedEnd.hasYear) {
                        explicitUntilDate.add(1, "year");
                    } else if (!parsedStart.hasYear) {
                        explicitStartDate.subtract(1, "year");
                    }
                }

                if (baseDate.isSameOrAfter(explicitStartDate, "day") && baseDate.isSameOrBefore(explicitUntilDate, "day")) {
                    explicitNextDate = baseDate.clone();
                } else {
                    explicitNextDate = explicitStartDate.clone();
                }
                continue;
            }
        }

        for (let pass = 0; pass < 2; pass++) {
            const clauseMatch = segLower.match(/\b(until|til|till|thru|through|up\s*to|to|due|by|starting\s+from|starting|from|after)\s+([0-9\/\-\.a-z\s]+?)$/i);
            if (!clauseMatch) break;
            const kw = clauseMatch[1].toLowerCase();
            const argStr = clauseMatch[2].trim();
            const isStartKw = /^(starting\s+from|starting|from|after)$/.test(kw);

            if (isStartKw) {
                if (/\b(?:every|each|repeat)\b/i.test(clauseMatch[0])) break;
                let matchedStart = null;
                if (argStr === "tomorrow") {
                    matchedStart = kw === "after" ? baseDate.clone().add(2, "days") : baseDate.clone().add(1, "days");
                } else {
                    const parsedS = parseNaturalDate(argStr, baseDate);
                    if (parsedS) {
                        matchedStart = parsedS.date.clone();
                    } else {
                        const intv = parseInterval(argStr);
                        if (intv) matchedStart = addToDate(baseDate, intv);
                    }
                }
                if (!matchedStart) break;
                explicitStartDate = matchedStart;
                segLower = segLower.slice(0, clauseMatch.index).trim();
            } else {
                const parsedU = parseNaturalDate(argStr, baseDate);
                if (!parsedU) break;
                explicitUntilDate = parsedU.date.clone();
                segLower = segLower.slice(0, clauseMatch.index).trim();
            }
        }

        if (!segLower) continue;

        if (/^next\b/i.test(segLower)) {
            const parsedWhole = parseNaturalDate(segLower, baseDate);
            if (parsedWhole) {
                explicitNextDate = parsedWhole.date;
                continue;
            }
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

        if (/\b(?:weekdays?|workdays?)\b/i.test(segLower)) {
            explicitWeekdays = [1, 2, 3, 4, 5];
            explicitRepeat = "every weekday";
            explicitNextDate = getNextMatchingWeekdayDate(baseDate, explicitWeekdays, explicitStartDate);
            continue;
        }
        if (/\b(?:weekends?)\b/i.test(segLower)) {
            explicitWeekdays = [0, 6];
            explicitRepeat = "every weekend";
            explicitNextDate = getNextMatchingWeekdayDate(baseDate, explicitWeekdays, explicitStartDate);
            continue;
        }

        const detectedDays = [];
        const detectedNames = [];
        for (const word of segLower.split(/[\s,]+/)) {
            const cleanWord = word.replace(/[^a-z]/g, "");
            if (WEEKDAYS[cleanWord] !== undefined && !detectedDays.includes(WEEKDAYS[cleanWord])) {
                detectedDays.push(WEEKDAYS[cleanWord]);
                detectedNames.push(cleanWord);
            }
        }

        if (detectedDays.length > 0) {
            explicitWeekdays = detectedDays;
            if (detectedNames.length === 1) {
                explicitRepeat = `every ${detectedNames[0]}`;
            } else if (detectedNames.length === 2) {
                explicitRepeat = `every ${detectedNames[0]} and ${detectedNames[1]}`;
            } else {
                explicitRepeat = `every ${detectedNames.slice(0, -1).join(", ")}, and ${detectedNames[detectedNames.length - 1]}`;
            }
            explicitNextDate = getNextMatchingWeekdayDate(baseDate, explicitWeekdays, explicitStartDate);
            continue;
        }

        const isRecurKeyword = /^(?:repeat\s+every|every\s+repeat|repeating\s+every|recurring\s+every|recur\s+every|repeat|repeating|recurring|recur|every|each)\b/i.test(segLower);
        const cleanRecurPrefix = segLower.replace(/^(?:repeat\s+every|every\s+repeat|repeating\s+every|recurring\s+every|recur\s+every|repeat|repeating|recurring|recur|every|each)\s+/i, "").trim();
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

        const recurrenceTextOnly = segLower.replace(/\b(?:starting|after|from)\s+.+$/i, "").trim();
        const interval = parseInterval(recurrenceTextOnly || segLower);
        const hasFreqKeyword = /\b(daily|everyday|weekly|monthly|annually|annual|yearly|fortnightly|biweekly|bidaily|tridaily|quaddaily|triweekly|quadweekly|bimonthly|trimonthly|quadmonthly|quarterly|semiannually|biannually|half-yearly|triennially|quadrennially|quinquennially|decennially)\b/i.test(segLower);

        if ((isRecurKeyword || hasFreqKeyword) && interval) {
            explicitInterval = interval;
            explicitRepeat = formatRepeatUnits(interval);
            if (!explicitNextDate) {
                if (explicitStartDate) {
                    explicitNextDate = explicitStartDate.clone();
                } else {
                    explicitNextDate = addToDate(baseDate, interval);
                }
            }
            continue;
        }

        if (segLower === "today" || segLower === "tonight") {
            explicitNextDate = baseDate.clone();
        } else if (segLower === "tomorrow") {
            explicitNextDate = baseDate.clone().add(1, "days");
        } else if (segLower === "yesterday") {
            explicitNextDate = baseDate.clone().subtract(1, "days");
        } else if (segLower.startsWith("in ") || segLower.startsWith("after ")) {
            if (interval) explicitNextDate = addToDate(baseDate, interval);
        } else if (parsedDateObj) {
            explicitNextDate = parsedDateObj.date;
        }
    }

    if (explicitStartDate && (!explicitNextDate || explicitNextDate.isBefore(explicitStartDate, "day"))) {
        if (explicitUntilDate && baseDate.isSameOrAfter(explicitStartDate, "day") && baseDate.isSameOrBefore(explicitUntilDate, "day")) {
            explicitNextDate = baseDate.clone();
        } else {
            explicitNextDate = explicitStartDate.clone();
        }
    }

    return {
        isClear: false,
        explicitRepeat,
        explicitInterval,
        explicitWeekdays,
        explicitNextDate: explicitSnoozeDate || explicitNextDate,
        explicitStartDate,
        explicitUntilDate,
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
    if (targetDate.isSame(baseDate, "day")) {
        return "(today)";
    }
    const isPast = targetDate.isBefore(baseDate, "day");
    const start = isPast ? targetDate.clone().startOf("day") : baseDate.clone().startOf("day");
    const end = isPast ? baseDate.clone().startOf("day") : targetDate.clone().startOf("day");

    const years = end.diff(start, "years");
    const cur = start.clone().add(years, "years");
    const months = end.diff(cur, "months");
    cur.add(months, "months");
    const totalDays = end.diff(cur, "days");
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;

    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
    if (weeks > 0) parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`);
    if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);

    if (parts.length === 0) return "(today)";

    let unitStr = "";
    if (parts.length === 1) {
        unitStr = parts[0];
    } else if (parts.length === 2) {
        unitStr = `${parts[0]} and ${parts[1]}`;
    } else {
        const initial = parts.slice(0, -1).join(", ");
        unitStr = `${initial}, and ${parts[parts.length - 1]}`;
    }

    return isPast ? `(${unitStr} ago)` : `(in ${unitStr})`;
}

function cleanTaskString(text) {
    if (!text) return "";
    return text.replace(/^\s*-\s*\[.\]\s*/, "")
               .replace(/\[(?:<span[^>]*>)?[\?\#\°](?:\s*<\/span>)?\]\{[\s\S]*?\}\s*/g, "")
               .replace(/\{#\|[^}]+\}\s*/g, "")
               .replace(/::\s*[^:\n]*(?:::)?/g, "")
               .replace(/%%[\s\S]*?%%/g, "")
               .replace(/%[^\n]*/g, "")
               .replace(/^#\s+/, "")
               .replace(/\s*\[due:\s*[^\]]+\]/gi, "")
               .replace(/\s*\[sub:\s*[^\]]+\]/gi, "")
               .replace(/\s+/g, " ")
               .trim();
}

function cleanTaskForRename(text) {
    if (!text) return "";
    return cleanTaskString(text.replace(/(?:::|\s::)[^:\n]*$/, ""));
}

function computeTaskKey(cleanText, ancestorTexts = [], childTexts = [], dateStr = null) {
    if (!cleanText) return "";
    let key = cleanText;
    if (ancestorTexts && ancestorTexts.length > 0) {
        key = `${ancestorTexts.join(" > ")} > ${key}`;
    }
    if (dateStr) {
        key = `${key} [due: ${dateStr}]`;
    }
    if (childTexts && childTexts.length > 0) {
        const childPreview = childTexts.filter(Boolean).slice(0, 3).join(" | ");
        if (childPreview) {
            key = `${key} [sub: ${childPreview}]`;
        }
    }
    return key;
}

function scoreTaskCandidates(candidates, map, cleanText, targetNorm, contextKey, ancestorTexts = [], childTexts = [], targetDate = null) {
    let bestEntry = null;
    let maxScore = -1;
    let clearedMatch = null;

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const k = c.key;
        const entry = c.entry;
        if (!entry) continue;

        const isMatch = c.entryClean === cleanText ||
                        c.kClean === cleanText ||
                        k === cleanText ||
                        k.endsWith(` > ${cleanText}`) ||
                        c.normEntry === targetNorm ||
                        c.normK === targetNorm;

        if (!isMatch) continue;

        if (entry.isCleared) {
            clearedMatch = entry;
            continue;
        }

        let score = 0;
        if (k === contextKey) score += 1000;
        else if (c.kClean === cleanText) score += 500;

        if (targetDate && entry.next === targetDate) {
            score += 200;
        }

        if (entry.repeat || entry.next || entry.orig || entry.start || entry.until) {
            score += 300;
        }

        if (entry.childTexts && childTexts && childTexts.length > 0) {
            let matchCount = 0;
            for (let j = 0; j < entry.childTexts.length; j++) {
                if (childTexts.includes(entry.childTexts[j])) matchCount++;
            }
            if (matchCount > 0) {
                score += matchCount * 50;
            } else if (entry.childTexts.length > 0) {
                score -= 100;
            }
        }

        if (entry.ancestorTexts && ancestorTexts && ancestorTexts.length > 0) {
            let matchCount = 0;
            for (let j = 0; j < entry.ancestorTexts.length; j++) {
                if (ancestorTexts.includes(entry.ancestorTexts[j])) matchCount++;
            }
            score += matchCount * 30;
        }

        if (score > maxScore) {
            maxScore = score;
            bestEntry = entry;
        }
    }

    if (bestEntry && maxScore >= 0) return bestEntry;
    if (clearedMatch) return clearedMatch;
    if (contextKey && map[contextKey]) return map[contextKey];
    if (map[cleanText]) return map[cleanText];
    return null;
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

const DATE_CACHE = new Map();
const STRICT_DATE_CACHE = new Map();

function parseNoteDateFlexible(name) {
    if (!name) return window.moment();
    if (DATE_CACHE.has(name)) {
        const cached = DATE_CACHE.get(name);
        return cached ? cached.clone() : window.moment();
    }
    const clean = name.replace(/\[|\]/g, "").trim();
    const formats = [
        "Do [of] MMM, YYYY", "Do of MMM, YYYY", "D MMM YYYY", "Do MMMM YYYY",
        "Do [of] MMMM, YYYY", "Do of MMMM, YYYY", "Do [of] MMMM YYYY",
        "YYYY-MM-DD", "DD-MM-YYYY", "YYYY/MM/DD", "MM-DD-YYYY"
    ];
    for (const f of formats) {
        const m = window.moment(clean, f, true);
        if (m.isValid()) {
            DATE_CACHE.set(name, m);
            return m.clone();
        }
    }
    const loose = window.moment(clean, formats);
    if (loose.isValid()) {
        DATE_CACHE.set(name, loose);
        return loose.clone();
    }
    DATE_CACHE.set(name, null);
    return window.moment();
}

function parseNoteDateStrict(name) {
    if (!name) return null;
    if (STRICT_DATE_CACHE.has(name)) {
        const cached = STRICT_DATE_CACHE.get(name);
        return cached ? cached.clone() : null;
    }
    const clean = name.replace(/\[|\]/g, "").trim();
    const formats = [
        "Do [of] MMM, YYYY", "Do of MMM, YYYY", "D MMM YYYY", "Do MMMM YYYY",
        "Do [of] MMMM, YYYY", "Do of MMMM, YYYY", "Do [of] MMMM YYYY",
        "YYYY-MM-DD", "DD-MM-YYYY", "YYYY/MM/DD", "MM-DD-YYYY"
    ];
    for (const f of formats) {
        const m = window.moment(clean, f, true);
        if (m.isValid()) {
            STRICT_DATE_CACHE.set(name, m);
            return m.clone();
        }
    }
    STRICT_DATE_CACHE.set(name, null);
    return null;
}

function isTasksTrackerFile(file, app) {
    if (!file) return false;
    const cache = app.metadataCache.getFileCache(file);
    if (!cache || !cache.frontmatter) return false;
    const fm = cache.frontmatter;
    return fm.tasksTracker === true || fm.tasksTracker === "true" || fm.taskstracker === true || fm.taskstracker === "true" || fm.taskTracker === true || fm.taskTracker === "true" || fm.tasktracker === true || fm.tasktracker === "true";
}

function isPeriodicOrDailyNote(file, app, folderOverride) {
    if (!file) return false;
    if (isTasksTrackerFile(file, app)) return true;

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
    return !folderOverride && !!parseNoteDateStrict(baseName);
}

function isDailyNoteFile(file, app, folderOverride) {
    if (!file) return false;
    if (isTasksTrackerFile(file, app)) return false;
    const baseName = file.basename;
    const fileFolder = file.parent ? file.parent.path.replace(/^\/|\/$/g, "") : "";

    if (folderOverride) {
        const folder = folderOverride.replace(/^\/|\/$/g, "");
        const folderExists = !!app.vault.getAbstractFileByPath(folder);
        if (folderExists) {
            return folder === fileFolder && !!parseNoteDateStrict(baseName);
        }
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
    return !!parseNoteDateStrict(baseName);
}

function collectDomAncestorTaskTexts(container) {
    const texts = [];
    if (!container || container.tagName !== "LI") return texts;
    let cur = container.parentElement ? container.parentElement.closest("li") : null;
    while (cur) {
        texts.push(cleanTaskString(extractDirectTextContent(cur)));
        cur = cur.parentElement ? cur.parentElement.closest("li") : null;
    }
    return texts.reverse();
}

function collectDomChildTaskTexts(container) {
    const texts = [];
    if (!container || container.tagName !== "LI") return texts;
    const nestedList = container.querySelector(":scope > ul, :scope > ol");
    if (!nestedList) return texts;
    const childLis = nestedList.querySelectorAll(":scope > li");
    for (const cLi of childLis) {
        const t = cleanTaskString(extractDirectTextContent(cLi));
        if (t) texts.push(t);
    }
    return texts;
}

function isIsoDateStr(s) {
    return typeof s === "string" && s.length === 10 && s[4] === "-" && s[7] === "-";
}

function isTaskOverdue(data, noteDateOrStr) {
    if (!data || !data.next || !noteDateOrStr) return false;
    if (data.repeat && DAILY_REPEAT_RE.test(data.repeat)) return false;
    const noteDateStr = typeof noteDateOrStr === "string" ? noteDateOrStr : noteDateOrStr.format("YYYY-MM-DD");
    if (data.start && data.until) {
        if (isIsoDateStr(data.until)) {
            return noteDateStr > data.until;
        }
        const untilM = window.moment(data.until, "YYYY-MM-DD");
        return untilM.isValid() && window.moment(noteDateStr, "YYYY-MM-DD").isAfter(untilM, "day");
    }
    if (isIsoDateStr(data.next)) {
        return data.next < noteDateStr;
    }
    const nextM = window.moment(data.next, "YYYY-MM-DD");
    return nextM.isValid() && nextM.isBefore(window.moment(noteDateStr, "YYYY-MM-DD"), "day");
}

function extractDirectTextContent(element) {
    let text = "";
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE && !["UL", "OL"].includes(child.tagName)) {
            if (!child.classList.contains("task-progress-badge") && !child.classList.contains("task-custom-tooltip")) {
                text += child.textContent;
            }
        }
    }
    return text.trim();
}

async function bulkImportTasksFromContent(plugin, content, sourceFileKey, isTracker = true) {
    const noteDate = isTracker ? window.moment() : parseNoteDateFlexible(sourceFileKey);
    const normalizedContent = content.replace(/\r/g, "");
    const lines = normalizedContent.split("\n");
    const lineCount = lines.length;

    const taskItems = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
        const text = lines[i];
        const isTask = TASK_LINE_RE.test(text);
        const isHeading = !isTask && HEADING_LINE_RE.test(text);
        const indentMatch = text.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;
        taskItems[i] = { lineNum: i, text, isTask, isHeading, indent };
    }

    let importedCount = 0;
    const modifiedLines = [...lines];

    for (let i = 0; i < lineCount; i++) {
        const item = taskItems[i];
        if (!item.isTask && !item.isHeading) continue;

        const match = item.text.match(TAG_END_RE);
        if (!match) continue;

        const beforeMatch = item.text.slice(0, match.index);
        if (((beforeMatch.match(/`/g) || []).length % 2) !== 0) continue;

        const rawTag = match[1].trim();
        const cleanLine = item.text.replace(TAG_END_RE, "").trimEnd();
        modifiedLines[i] = cleanLine;

        if (item.isHeading) {
            const headingText = cleanHeadingString(cleanLine);
            const headingType = plugin.normalizeHeadingType(rawTag);
            if (headingType) {
                if (!plugin.store.headings) plugin.store.headings = {};
                if (!plugin.store.headings[sourceFileKey]) plugin.store.headings[sourceFileKey] = {};
                plugin.store.headings[sourceFileKey][headingText.toLowerCase()] = headingType;
            }
            continue;
        }

        const ancestorTexts = [];
        let curIndent = item.indent;
        for (let p = i - 1; p >= 0; p--) {
            if (taskItems[p].isTask && taskItems[p].indent < curIndent) {
                ancestorTexts.unshift(cleanTaskString(taskItems[p].text));
                curIndent = taskItems[p].indent;
                if (curIndent === 0) break;
            }
        }

        const childTexts = [];
        let directChildIndent = -1;
        for (let c = i + 1; c < lineCount; c++) {
            if (taskItems[c].indent <= item.indent) break;
            if (taskItems[c].isTask) {
                if (directChildIndent === -1) directChildIndent = taskItems[c].indent;
                if (taskItems[c].indent === directChildIndent) {
                    childTexts.push(cleanTaskString(taskItems[c].text));
                }
            }
        }

        const cleanText = cleanTaskString(cleanLine);
        const parsed = parseTaskTag(rawTag, noteDate, null);
        const nextStrTemp = parsed.explicitNextDate ? parsed.explicitNextDate.format("YYYY-MM-DD") : null;
        const taskKey = computeTaskKey(cleanText, ancestorTexts, childTexts, isTracker ? nextStrTemp : null);

        if (!parsed.isClear) {
            const repeat = parsed.explicitRepeat;
            const orig = parsed.explicitOrigDate ? parsed.explicitOrigDate.format("YYYY-MM-DD") : noteDate.format("YYYY-MM-DD");
            const start = parsed.explicitStartDate ? parsed.explicitStartDate.format("YYYY-MM-DD") : null;
            const until = parsed.explicitUntilDate ? parsed.explicitUntilDate.format("YYYY-MM-DD") : null;
            const isOptional = parsed.hasExplicitOptional ? parsed.isOptional : false;

            let nextStr = null;
            if (parsed.explicitNextDate) {
                nextStr = parsed.explicitNextDate.format("YYYY-MM-DD");
            } else if (start && window.moment(start, "YYYY-MM-DD").isAfter(noteDate, "day")) {
                nextStr = start;
            } else if (parsed.explicitInterval) {
                if (parsed.explicitInterval.days === 1 && !parsed.explicitInterval.weeks && !parsed.explicitInterval.months && !parsed.explicitInterval.years) {
                    nextStr = noteDate.clone().add(1, "days").format("YYYY-MM-DD");
                } else {
                    nextStr = addToDate(noteDate, parsed.explicitInterval).format("YYYY-MM-DD");
                }
            }

            if (!plugin.store.tasks) plugin.store.tasks = {};
            if (!plugin.store.tasks[sourceFileKey]) plugin.store.tasks[sourceFileKey] = {};

            plugin.store.tasks[sourceFileKey][taskKey] = {
                cleanText,
                contextKey: taskKey,
                ancestorTexts,
                childTexts,
                repeat,
                next: nextStr,
                orig,
                start,
                until,
                isOptional,
                streak: 0,
                weekdays: parsed.explicitWeekdays || null,
                rawTag,
                fromTracker: isTracker ? sourceFileKey : null
            };
            importedCount++;
        }
    }

    if (importedCount > 0) {
        plugin.invalidateSortCache(sourceFileKey);
        await plugin.flushStore();
    }

    return { importedCount, modifiedContent: modifiedLines.join("\n") };
}

function getEditorViewFile(plugin, view) {
    if (typeof editorInfoField !== "undefined") {
        try {
            const info = view.state.field(editorInfoField, false);
            if (info && info.file) return info.file;
        } catch (e) {}
    }
    return plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file || null;
}

function createTagDecorationExtension(plugin) {
    const decorator = new MatchDecorator({
        regexp: /(?<=^|\s)::[^\n]*/g,
        decoration: (match, view, pos) => {
            const line = view.state.doc.lineAt(pos);
            const lineText = line.text;
            if (!TASK_LINE_RE.test(lineText) && !HEADING_LINE_RE.test(lineText)) {
                return null;
            }
            const beforeMatch = lineText.substring(0, pos - line.from);
            if (((beforeMatch.match(/`/g) || []).length % 2) !== 0) {
                return null;
            }
            const file = getEditorViewFile(plugin, view);
            if (!file || !isPeriodicOrDailyNote(file, plugin.app, plugin.store.settings.folderOverride)) {
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
                <circle class="task-progress-ring-fill ${this.percent === 100 ? "complete" : ""}" cx="8" cy="8" r="5.5" stroke-dasharray="${strokeDash} ${circumference}"></circle>
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
                this.lastStoreVersion = plugin.storeVersion;
                const file = getEditorViewFile(plugin, view);
                this.lastFilePath = file ? file.path : "";
                this.decorations = this.buildDeco(view, file);
            }
            update(update) {
                const file = getEditorViewFile(plugin, update.view);
                const filePath = file ? file.path : "";
                if (update.docChanged || this.lastStoreVersion !== plugin.storeVersion || this.lastFilePath !== filePath) {
                    this.lastStoreVersion = plugin.storeVersion;
                    this.lastFilePath = filePath;
                    this.decorations = this.buildDeco(update.view, file);
                }
            }
            buildDeco(view, file) {
                const doc = view.state.doc;
                const lineCount = doc.lines;
                const lineData = new Array(lineCount);

                const fileKey = file ? file.basename : "";
                const isDailyOrTracker = file ? isPeriodicOrDailyNote(file, plugin.app, plugin.store.settings.folderOverride) : false;
                const isTracker = isDailyOrTracker && isTasksTrackerFile(file, plugin.app);
                const noteDateStr = isDailyOrTracker ? (isTracker ? window.moment() : parseNoteDateFlexible(fileKey)).format("YYYY-MM-DD") : null;

                const ancestorStack = [];

                for (let i = 1; i <= lineCount; i++) {
                    const line = doc.line(i);
                    const text = line.text;
                    const isTask = TASK_LINE_RE.test(text);
                    const indentMatch = text.match(/^(\s*)/);
                    const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

                    if (!isTask) {
                        while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
                            ancestorStack.pop();
                        }
                        lineData[i - 1] = { from: line.from, to: line.to, isTask: false, indent };
                        continue;
                    }

                    while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
                        ancestorStack.pop();
                    }

                    const cleanText = cleanTaskString(text);
                    const ancestorTexts = ancestorStack.length > 0 ? ancestorStack.map(a => a.cleanText) : [];
                    ancestorStack.push({ indent, cleanText });

                    lineData[i - 1] = {
                        from: line.from,
                        to: line.to,
                        isTask: true,
                        isChecked: CHECKED_LINE_RE.test(text),
                        hasInlineOptional: INLINE_OPTIONAL_RE.test(text),
                        indent,
                        cleanText,
                        ancestorTexts,
                        isOptional: false,
                        isOverdue: false
                    };
                }

                const decos = [];

                for (let i = lineCount - 1; i >= 0; i--) {
                    const item = lineData[i];
                    if (!item.isTask) continue;

                    const hasChildren = i + 1 < lineCount && lineData[i + 1].indent > item.indent;
                    let total = 0;
                    let completed = 0;
                    let childTexts = [];

                    if (hasChildren) {
                        let directIndent = -1;
                        for (let j = i + 1; j < lineCount; j++) {
                            const child = lineData[j];
                            if (child.indent <= item.indent) break;
                            if (!child.isTask) continue;

                            if (directIndent === -1) {
                                directIndent = child.indent;
                            }

                            if (child.indent === directIndent) {
                                childTexts.push(child.cleanText);
                                if (!child.isOptional) {
                                    total++;
                                    if (child.isChecked) completed++;
                                }
                            }
                        }
                    }

                    let data = null;
                    if (isDailyOrTracker && fileKey) {
                        data = plugin.getTaskData(fileKey, item.cleanText, {
                            ancestorTexts: item.ancestorTexts,
                            childTexts
                        });
                    }

                    item.isOptional = item.hasInlineOptional || !!(data && data.isOptional);
                    if (!item.isChecked && data && noteDateStr) {
                        item.isOverdue = isTaskOverdue(data, noteDateStr);
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

        if (data.start && data.until) {
            const startM = window.moment(data.start, "YYYY-MM-DD");
            const untilM = window.moment(data.until, "YYYY-MM-DD");
            if (startM.isValid() && untilM.isValid()) {
                const getCleanRel = (target) => formatCompoundRelativeDiff(target, refDate).replace(/^\(|\)$/g, "");
                let diffHtml = "";

                if (refDate.isBefore(startM, "day")) {
                    const startDiff = getCleanRel(startM);
                    const endDiff = getCleanRel(untilM);
                    diffHtml = `
                        <div class="task-tooltip-diff-grid">
                            <span class="task-tooltip-diff-action">starts</span>
                            <span class="task-tooltip-diff-val">${startDiff}</span>

                            <span class="task-tooltip-diff-action">ends</span>
                            <span class="task-tooltip-diff-val">${endDiff}</span>
                        </div>
                    `;
                } else if (refDate.isSameOrAfter(startM, "day") && refDate.isSameOrBefore(untilM, "day")) {
                    const endDiff = getCleanRel(untilM);
                    diffHtml = `
                        <div class="task-tooltip-diff-grid">
                            <span class="task-tooltip-diff-action">ends</span>
                            <span class="task-tooltip-diff-val">${endDiff}</span>
                        </div>
                    `;
                } else {
                    const endDiff = getCleanRel(untilM);
                    diffHtml = `
                        <div class="task-tooltip-diff-grid">
                            <span class="task-tooltip-diff-action">ended</span>
                            <span class="task-tooltip-diff-val">${endDiff}</span>
                        </div>
                    `;
                }

                html += `
                    <div class="task-tooltip-section">
                        <div class="task-tooltip-label">time period:</div>
                        <div class="task-tooltip-period-grid">
                            <span class="task-tooltip-period-prefix">from</span>
                            <span class="task-tooltip-period-date">${formatOrdinalDate(startM)}</span>
                            <span class="task-tooltip-period-prefix">to</span>
                            <span class="task-tooltip-period-date">${formatOrdinalDate(untilM)}</span>
                        </div>
                        ${diffHtml}
                    </div>
                `;
            }
        }

        if (data.repeat) {
            html += `
                <div class="task-tooltip-section">
                    <div class="task-tooltip-label">repeat:</div>
                    <div class="task-tooltip-value">${data.repeat}</div>
                </div>
            `;
        }

        if (data.next && !(data.start && data.until)) {
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

        if (data.until && !(data.start && data.until)) {
            const untilM = window.moment(data.until, "YYYY-MM-DD");
            if (untilM.isValid()) {
                html += `
                    <div class="task-tooltip-section">
                        <div class="task-tooltip-label">until:</div>
                        <div class="task-tooltip-value">${formatOrdinalDate(untilM)}<br><span class="task-tooltip-diff">${formatCompoundRelativeDiff(untilM, refDate)}</span></div>
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

        if (!html) return;
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
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        if (this.tooltipEl && this.tooltipEl.parentNode) {
            this.tooltipEl.parentNode.removeChild(this.tooltipEl);
        }
    }
}

class PurgeSchedulesModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.mode = "before";
        this.beforeDate = window.moment().format("YYYY-MM-DD");
        this.rangeStart = window.moment().subtract(7, "days").format("YYYY-MM-DD");
        this.rangeEnd = window.moment().format("YYYY-MM-DD");
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Purge Task Schedules" });

        new Setting(contentEl)
            .setName("Purge Mode")
            .setDesc("Select how to purge schedule metadata across stored notes.")
            .addDropdown((drop) => {
                drop.addOption("before", "Before a specific date")
                    .addOption("period", "During a date range")
                    .setValue(this.mode)
                    .onChange((val) => {
                        this.mode = val;
                        this.onOpen();
                    });
            });

        if (this.mode === "before") {
            new Setting(contentEl)
                .setName("Cutoff Date")
                .setDesc("Purge all task schedules in notes dated before this day.")
                .addText((text) => {
                    text.inputEl.type = "date";
                    text.setValue(this.beforeDate)
                        .onChange((val) => {
                            this.beforeDate = val;
                        });
                });
        } else {
            new Setting(contentEl)
                .setName("Start Date")
                .setDesc("Beginning of the purge date range.")
                .addText((text) => {
                    text.inputEl.type = "date";
                    text.setValue(this.rangeStart)
                        .onChange((val) => {
                            this.rangeStart = val;
                        });
                });

            new Setting(contentEl)
                .setName("End Date")
                .setDesc("End of the purge date range.")
                .addText((text) => {
                    text.inputEl.type = "date";
                    text.setValue(this.rangeEnd)
                        .onChange((val) => {
                            this.rangeEnd = val;
                        });
                });
        }

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText("Purge Schedules")
                   .setClass("daily-tasks-settings-btn-danger")
                   .onClick(async () => {
                       const res = await this.plugin.purgeTaskSchedules({
                           mode: this.mode,
                           beforeDate: this.beforeDate,
                           rangeStart: this.rangeStart,
                           rangeEnd: this.rangeEnd
                       });
                       new Notice(`Purged ${res.purgedTasks} task(s) across ${res.purgedNotes} note(s).`);
                       this.close();
                   });
            })
            .addButton((btn) => {
                btn.setButtonText("Cancel").onClick(() => this.close());
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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
            .setDesc("Restrict scheduling/rollover to notes in this folder specifically. Leave blank to use whatever Obsidian's core Daily Notes plugin (or Periodic Notes) is configured with.")
            .addText((text) => {
                text.setPlaceholder("e.g. Daily Notes")
                    .setValue(this.plugin.store.settings.folderOverride || "")
                    .onChange(async (value) => {
                        this.plugin.store.settings.folderOverride = value.trim();
                        await this.plugin.saveData(this.plugin.store);
                        this.plugin.refreshOpenEditors();
                    });
            });

        new Setting(containerEl)
            .setName("Auto-clean Non-existing Tasks")
            .setDesc("Periodically scan data.json and delete metadata for tasks or note files that no longer exist in your vault.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.store.settings.autoCleanupEnabled !== false)
                    .onChange(async (value) => {
                        this.plugin.store.settings.autoCleanupEnabled = value;
                        await this.plugin.saveData(this.plugin.store);
                        this.plugin.setupCleanupInterval();
                    });
            });

        new Setting(containerEl)
            .setName("Auto-cleanup Interval (Hours)")
            .setDesc("How often (in hours) to automatically check and clear non-existing tasks from data.json.")
            .addText((text) => {
                text.setPlaceholder("12")
                    .setValue(String(this.plugin.store.settings.cleanupIntervalHours ?? 12))
                    .onChange(async (value) => {
                        const num = Math.max(1, parseFloat(value) || 12);
                        this.plugin.store.settings.cleanupIntervalHours = num;
                        await this.plugin.saveData(this.plugin.store);
                        this.plugin.setupCleanupInterval();
                    });
            });

        new Setting(containerEl)
            .setName("Clean Non-existing Tasks Now")
            .setDesc("Scan the vault and purge all non-existing tasks and deleted note files from data.json immediately.")
            .addButton((btn) => {
                btn.setButtonText("Clean Now").onClick(async () => {
                    const res = await this.plugin.cleanupNonExistingTasks();
                    new Notice(`Cleaned up ${res.cleanedTasks} stale task(s) across ${res.cleanedFiles} note file(s).`);
                });
            });

        new Setting(containerEl)
            .setName("Purge Schedules by Date/Period")
            .setDesc("Delete stored task schedule data before a specific date or within a selected date range.")
            .addButton((btn) => {
                btn.setButtonText("Purge Schedules...").onClick(() => {
                    new PurgeSchedulesModal(this.app, this.plugin).open();
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
                       this.plugin.invalidateSortCache();
                       await this.plugin.saveData(this.plugin.store);
                       this.plugin.refreshOpenEditors();
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
        let title = tp;
        if (tp && typeof tp === "object") {
            title = tp.file?.title || tp.title || undefined;
        }
        return await this.plugin.getRolloverContent("tasks", title).catch(() => "- [ ] ");
    }

    async planned(tp) {
        let title = tp;
        if (tp && typeof tp === "object") {
            title = tp.file?.title || tp.title || undefined;
        }
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
        if (!("autoCleanupEnabled" in this.store.settings)) this.store.settings.autoCleanupEnabled = true;
        if (!("cleanupIntervalHours" in this.store.settings)) this.store.settings.cleanupIntervalHours = 12;

        this.tooltipManager = new TooltipManager();
        this.isAutoUpdatingCheckboxes = false;
        this.isInternalEditorUpdate = false;
        this.scanTimeout = null;
        this._saveTimeout = null;
        this.cleanupTimer = null;
        this.fileTaskSnapshots = new Map();
        this._fileIndexCache = new Map();
        this._globalDateIndex = null;
        this._getTaskDataCache = new Map();
        this._cachedSortedFiles = null;
        this._rolloverCache = null;
        this.storeVersion = 0;

        this.tasksApi = new TasksTemplateApi(this);
        window.tasks = this.tasksApi;
        window.TaskSchedulerAPI = this;

        if (this.store && this.store.tasks) {
            let repaired = false;
            for (const fileKey of Object.keys(this.store.tasks)) {
                let noteDate = null;
                for (const tKey of Object.keys(this.store.tasks[fileKey])) {
                    const t = this.store.tasks[fileKey][tKey];
                    if (t && t.rawTag && (!t.start || !t.until || !t.next)) {
                        if (/\b(?:from|to|until|thru|through)\b/i.test(t.rawTag)) {
                            if (!noteDate) noteDate = parseNoteDateFlexible(fileKey);
                            const parsed = parseTaskTag(t.rawTag, noteDate, t);
                            if (parsed.explicitStartDate || parsed.explicitUntilDate || parsed.explicitNextDate) {
                                if (parsed.explicitStartDate) t.start = parsed.explicitStartDate.format("YYYY-MM-DD");
                                if (parsed.explicitUntilDate) t.until = parsed.explicitUntilDate.format("YYYY-MM-DD");
                                if (parsed.explicitNextDate) t.next = parsed.explicitNextDate.format("YYYY-MM-DD");
                                repaired = true;
                            }
                        }
                    }
                }
            }
            if (repaired) {
                await this.saveData(this.store);
            }
        }

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
                if (!file) return;

                menu.addItem((item) => {
                    item.setTitle("Import Tasks from this File")
                        .setIcon("download")
                        .onClick(async () => {
                            const content = await this.app.vault.read(file);
                            const isTracker = isTasksTrackerFile(file, this.app);
                            const result = await bulkImportTasksFromContent(this, content, file.basename, isTracker);
                            if (result.importedCount > 0) {
                                await this.app.vault.modify(file, result.modifiedContent);
                                this.refreshOpenEditors();
                                new Notice(`Successfully imported ${result.importedCount} scheduled task(s) from "${file.basename}".`);
                            } else {
                                new Notice(`No unimported scheduled task tags found in "${file.basename}".`);
                            }
                        });
                });

                if (!isPeriodicOrDailyNote(file, this.app, this.store.settings.folderOverride)) return;
                menu.addItem((item) => {
                    item.setTitle("Clear Scheduled Tasks")
                        .setIcon("trash")
                        .onClick(async () => {
                            const fileKey = file.basename;
                            if (this.store.tasks[fileKey]) delete this.store.tasks[fileKey];
                            if (this.store.headings[fileKey]) delete this.store.headings[fileKey];
                            this.invalidateSortCache();
                            await this.flushStore();
                            this.refreshOpenEditors();
                            new Notice(`Cleared data for ${fileKey}`);
                        });
                });
            })
        );

        this.registerDomEvent(document, "mouseover", (evt) => {
            const checkbox = evt.target.closest('input[type="checkbox"], .task-list-item-checkbox, .cm-formatting-task');
            const headingEl = !checkbox ? evt.target.closest("h1, h2, h3, h4, h5, h6, .HyperMD-header") : null;
            if (!checkbox && !headingEl) return;

            const targetView = this.getMarkdownViewForTarget(evt.target);
            if (!targetView || !targetView.file) return;
            if (!isPeriodicOrDailyNote(targetView.file, this.app, this.store.settings.folderOverride)) return;

            const fileKey = targetView.file.basename;
            const isTracker = isTasksTrackerFile(targetView.file, this.app);
            const noteDate = isTracker ? window.moment() : parseNoteDateFlexible(fileKey);

            if (headingEl) {
                const headingText = cleanHeadingString(headingEl.textContent || "");
                const hType = this.getHeadingType(fileKey, headingText);
                if (hType) {
                    headingEl.classList.add("heading-has-type");
                    this.tooltipManager.showHeading(headingEl, hType);
                }
                return;
            }

            let cleanText = "";
            let ancestorCleanTexts = [];
            let childCleanTexts = [];

            const cmView = targetView.editor && targetView.editor.cm;
            if (cmView && cmView.dom && cmView.dom.contains(checkbox) && typeof cmView.posAtDOM === "function") {
                try {
                    const pos = cmView.posAtDOM(checkbox);
                    const lineNum = cmView.state.doc.lineAt(pos).number - 1;
                    const line = targetView.editor.getLine(lineNum);
                    cleanText = cleanTaskString(line);

                    let currentIndent = (line.match(/^(\s*)/)[1] || "").replace(/\t/g, "    ").length;
                    if (currentIndent > 0) {
                        for (let p = lineNum - 1; p >= 0; p--) {
                            const pLine = targetView.editor.getLine(p);
                            if (TASK_LINE_RE.test(pLine)) {
                                const pIndent = (pLine.match(/^(\s*)/)[1] || "").replace(/\t/g, "    ").length;
                                if (pIndent < currentIndent) {
                                    ancestorCleanTexts.unshift(cleanTaskString(pLine));
                                    currentIndent = pIndent;
                                    if (currentIndent === 0) break;
                                }
                            }
                        }
                    }

                    const totalLines = targetView.editor.lineCount();
                    const selfIndent = (line.match(/^(\s*)/)[1] || "").replace(/\t/g, "    ").length;
                    let directChildIndent = -1;
                    for (let c = lineNum + 1; c < totalLines; c++) {
                        const cLine = targetView.editor.getLine(c);
                        const cIndentMatch = cLine.match(/^(\s*)/);
                        const cIndent = cIndentMatch ? cIndentMatch[1].replace(/\t/g, "    ").length : 0;
                        if (cIndent <= selfIndent) break;
                        if (TASK_LINE_RE.test(cLine)) {
                            if (directChildIndent === -1) directChildIndent = cIndent;
                            if (cIndent === directChildIndent) {
                                childCleanTexts.push(cleanTaskString(cLine));
                            }
                        }
                    }
                } catch (e) {
                    const container = checkbox.closest("li, .cm-line");
                    cleanText = cleanTaskString(container ? extractDirectTextContent(container) : "");
                    ancestorCleanTexts = collectDomAncestorTaskTexts(container);
                    childCleanTexts = collectDomChildTaskTexts(container);
                }
            } else {
                const container = checkbox.closest("li, .cm-line");
                cleanText = cleanTaskString(container ? extractDirectTextContent(container) : "");
                ancestorCleanTexts = collectDomAncestorTaskTexts(container);
                childCleanTexts = collectDomChildTaskTexts(container);
            }

            if (!cleanText) return;

            let data = this.getTaskData(fileKey, cleanText, { ancestorTexts: ancestorCleanTexts, childTexts: childCleanTexts });
            if (!data) {
                for (let idx = ancestorCleanTexts.length - 1; idx >= 0; idx--) {
                    data = this.getTaskData(fileKey, ancestorCleanTexts[idx]);
                    if (data) break;
                }
            }

            if (data && (data.repeat || data.next || data.orig || data.start || data.until || data.isOptional)) {
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
            this.app.workspace.on("editor-change", (editor, info) => {
                if (this.isAutoUpdatingCheckboxes || this.isInternalEditorUpdate) return;
                const file = (info && info.file) || this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
                if (!file || !isPeriodicOrDailyNote(file, this.app, this.store.settings.folderOverride)) return;

                const fileKey = file.basename;
                const { structureChanged } = this.handleEditorTaskRenames(editor, fileKey);

                if (structureChanged) {
                    this.autoCheckParentTasks(editor, fileKey);
                }

                this.requestScan(editor, fileKey);
            })
        );

        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (!file) return;
                if (!isPeriodicOrDailyNote(file, this.app, this.store.settings.folderOverride)) return;

                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView && activeView.file && activeView.file.path === file.path && activeView.editor) {
                    const content = activeView.editor.getValue();
                    const tagMatches = content.match(/(?:::|\s::)\s*([^:\n]+)\s*::/g);
                    if (tagMatches && tagMatches.length >= 10) {
                        const isTracker = isTasksTrackerFile(file, this.app);
                        const res = await bulkImportTasksFromContent(this, content, file.basename, isTracker);
                        if (res.importedCount > 0) {
                            this.isInternalEditorUpdate = true;
                            activeView.editor.setValue(res.modifiedContent);
                            this.isInternalEditorUpdate = false;
                        }
                    }

                    this.updateFileSnapshot(activeView.editor, file.basename);
                    this.requestScan(activeView.editor, file.basename);
                }
            })
        );

        this.app.workspace.onLayoutReady(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file && activeView.editor && isPeriodicOrDailyNote(activeView.file, this.app, this.store.settings.folderOverride)) {
                this.updateFileSnapshot(activeView.editor, activeView.file.basename);
            }
        });

        this.setupCleanupInterval();
        setTimeout(async () => {
            await this.cleanupExpiredTrackerTasks();
        }, 1200);
    }

    getMarkdownViewForTarget(target) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.containerEl.contains(target)) {
            return activeView;
        }
        let matchedView = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!matchedView && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(target)) {
                matchedView = leaf.view;
            }
        });
        return matchedView;
    }

    refreshOpenEditors() {
        this.storeVersion++;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                if (leaf.view.editor?.cm?.dispatch) {
                    try {
                        leaf.view.editor.cm.dispatch({});
                    } catch (e) {}
                }
                if (leaf.view.getMode && leaf.view.getMode() === "preview" && leaf.view.previewMode?.rerender) {
                    try {
                        leaf.view.previewMode.rerender(true);
                    } catch (e) {}
                }
            }
        });
    }

    buildEditorSnapshot(editor) {
        const lineCount = editor.lineCount();
        const tasks = [];
        const headings = [];
        const ancestorStack = [];

        for (let i = 0; i < lineCount; i++) {
            const text = editor.getLine(i).replace(/\r/g, "");
            const isTask = TASK_LINE_RE.test(text);
            const indentMatch = text.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

            if (isTask) {
                while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
                    ancestorStack.pop();
                }
                const clean = cleanTaskString(text);
                const renameClean = cleanTaskForRename(text);
                const ancestorTexts = ancestorStack.map(a => a.clean);
                ancestorStack.push({ indent, clean });
                tasks.push({
                    line: i,
                    raw: text,
                    clean,
                    renameClean,
                    isChecked: CHECKED_LINE_RE.test(text),
                    indent,
                    ancestorTexts,
                    childTexts: []
                });
            } else {
                while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
                    ancestorStack.pop();
                }
                if (HEADING_LINE_RE.test(text)) {
                    headings.push({ line: i, raw: text, clean: cleanHeadingString(text) });
                }
            }
        }

        for (let i = 0; i < tasks.length; i++) {
            const parent = tasks[i];
            let directIndent = -1;
            for (let j = i + 1; j < tasks.length; j++) {
                const child = tasks[j];
                if (child.indent <= parent.indent) break;
                if (directIndent === -1) directIndent = child.indent;
                if (child.indent === directIndent) {
                    parent.childTexts.push(child.clean);
                }
            }
        }

        return { tasks, headings };
    }

    updateFileSnapshot(editor, fileKey) {
        this.fileTaskSnapshots.set(fileKey, this.buildEditorSnapshot(editor));
    }

    handleEditorTaskRenames(editor, fileKey) {
        const currentSnapshot = this.buildEditorSnapshot(editor);
        const prevSnapshot = this.fileTaskSnapshots.get(fileKey);

        if (!prevSnapshot) {
            this.fileTaskSnapshots.set(fileKey, currentSnapshot);
            return { structureChanged: true };
        }

        const prevTasks = prevSnapshot.tasks;
        const currentTasks = currentSnapshot.tasks;
        const prevHeadings = prevSnapshot.headings;
        const currentHeadings = currentSnapshot.headings;

        let structureChanged = prevTasks.length !== currentTasks.length;

        if (!structureChanged) {
            for (let i = 0; i < currentTasks.length; i++) {
                if (prevTasks[i].isChecked !== currentTasks[i].isChecked || prevTasks[i].indent !== currentTasks[i].indent) {
                    structureChanged = true;
                    break;
                }
            }
        }

        if (prevTasks.length === currentTasks.length) {
            let diffCount = 0;
            let oldT = null;
            let newT = null;

            for (let idx = 0; idx < currentTasks.length; idx++) {
                if (prevTasks[idx].raw === currentTasks[idx].raw) continue;
                if (prevTasks[idx].renameClean !== currentTasks[idx].renameClean) {
                    diffCount++;
                    oldT = prevTasks[idx];
                    newT = currentTasks[idx];
                    if (diffCount > 1) break;
                }
            }

            if (diffCount === 1 && oldT && newT && oldT.renameClean && newT.renameClean) {
                this.renameTaskData(fileKey, oldT.renameClean, newT.renameClean, oldT, newT);
            }
        }

        if (prevHeadings.length === currentHeadings.length) {
            for (let idx = 0; idx < currentHeadings.length; idx++) {
                if (prevHeadings[idx].raw === currentHeadings[idx].raw) continue;
                const prevH = prevHeadings[idx];
                const currH = currentHeadings[idx];
                if (prevH.clean && currH.clean && prevH.clean !== currH.clean) {
                    this.renameHeadingData(fileKey, prevH.clean, currH.clean);
                }
            }
        }

        this.fileTaskSnapshots.set(fileKey, currentSnapshot);
        return { structureChanged };
    }

    renameTaskData(fileKey, oldTaskText, newTaskText, oldMeta = null, newMeta = null) {
        if (!oldTaskText || !newTaskText || oldTaskText === newTaskText) return;
        let existingData = null;

        const oldAncestors = oldMeta?.ancestorTexts || [];
        const oldChildren = oldMeta?.childTexts || [];
        const oldContextKey = computeTaskKey(oldTaskText, oldAncestors, oldChildren);

        if (this.store.tasks && this.store.tasks[fileKey]) {
            const matched = this.matchTaskInFile(fileKey, oldTaskText, oldContextKey, oldAncestors, oldChildren);
            if (matched && !matched.isCleared) {
                existingData = matched;
                const oldCleanNorm = normalizeForMatching(oldTaskText);
                for (const k of Object.keys(this.store.tasks[fileKey])) {
                    const entry = this.store.tasks[fileKey][k];
                    if (entry === matched) {
                        delete this.store.tasks[fileKey][k];
                        continue;
                    }
                    const entryClean = entry?.cleanText || cleanTaskString(k);
                    const sameClean = k === oldTaskText || entryClean === oldTaskText || normalizeForMatching(entryClean) === oldCleanNorm;
                    if (sameClean && (!entry?.ancestorTexts || entry.ancestorTexts.join("\0") === oldAncestors.join("\0"))) {
                        delete this.store.tasks[fileKey][k];
                    }
                }
            }
        }

        if (!existingData) {
            existingData = this.getTaskData(fileKey, oldTaskText, { ancestorTexts: oldAncestors, childTexts: oldChildren });
        }

        if (existingData && !existingData.isCleared) {
            if (!this.store.tasks) this.store.tasks = {};
            if (!this.store.tasks[fileKey]) this.store.tasks[fileKey] = {};
            const newAncestors = newMeta?.ancestorTexts || existingData.ancestorTexts || [];
            const newChildren = newMeta?.childTexts || existingData.childTexts || [];
            const newContextKey = computeTaskKey(newTaskText, newAncestors, newChildren);
            this.store.tasks[fileKey][newContextKey || newTaskText] = {
                ...existingData,
                cleanText: newTaskText,
                contextKey: newContextKey || newTaskText,
                ancestorTexts: newAncestors,
                childTexts: newChildren
            };
            this.invalidateSortCache(fileKey);
            this.requestSaveStore();
        }
    }

    renameHeadingData(fileKey, oldHeadingText, newHeadingText) {
        const oldH = oldHeadingText.toLowerCase();
        const newH = newHeadingText.toLowerCase();
        if (oldH === newH) return;

        if (this.store.headings && this.store.headings[fileKey] && this.store.headings[fileKey][oldH]) {
            const type = this.store.headings[fileKey][oldH];
            delete this.store.headings[fileKey][oldH];
            this.store.headings[fileKey][newH] = type;
            this.requestSaveStore();
        }
    }

    setupCleanupInterval() {
        if (this.cleanupTimer) {
            window.clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        const enabled = this.store.settings.autoCleanupEnabled !== false;
        const hours = Math.max(0.1, Number(this.store.settings.cleanupIntervalHours) || 12);

        if (enabled && hours > 0) {
            const ms = hours * 60 * 60 * 1000;
            setTimeout(async () => {
                await this.cleanupNonExistingTasks();
            }, 6000);

            this.cleanupTimer = window.setInterval(async () => {
                await this.cleanupNonExistingTasks();
            }, ms);
            this.registerInterval(this.cleanupTimer);
        }
    }

    async cleanupNonExistingTasks() {
        if (!this.store || !this.store.tasks) return { cleanedTasks: 0, cleanedFiles: 0 };

        const allFiles = this.app.vault.getMarkdownFiles();
        const fileMap = new Map();
        for (const f of allFiles) {
            fileMap.set(f.basename, f);
        }

        let cleanedTasks = 0;
        let cleanedFiles = 0;
        let changed = false;

        const fileKeys = Object.keys(this.store.tasks);
        for (const fileKey of fileKeys) {
            const file = fileMap.get(fileKey);
            if (!file) {
                const taskCount = Object.keys(this.store.tasks[fileKey] || {}).length;
                delete this.store.tasks[fileKey];
                if (this.store.headings && this.store.headings[fileKey]) {
                    delete this.store.headings[fileKey];
                }
                cleanedTasks += taskCount;
                cleanedFiles++;
                changed = true;
                continue;
            }

            let content = "";
            try {
                content = await this.app.vault.cachedRead(file);
            } catch (e) {
                continue;
            }

            const lines = content.split("\n");
            const existingTaskTexts = new Set();
            const existingHeadings = new Set();

            for (const line of lines) {
                if (TASK_LINE_RE.test(line)) {
                    const clean = cleanTaskString(line);
                    existingTaskTexts.add(clean);
                    existingTaskTexts.add(normalizeForMatching(clean));
                } else if (HEADING_LINE_RE.test(line)) {
                    existingHeadings.add(cleanHeadingString(line).toLowerCase());
                }
            }

            const taskEntries = this.store.tasks[fileKey];
            if (taskEntries) {
                for (const taskKey of Object.keys(taskEntries)) {
                    const clean = taskEntries[taskKey].cleanText || cleanTaskString(taskKey);
                    const cleanNorm = normalizeForMatching(clean);
                    if (!existingTaskTexts.has(clean) && !existingTaskTexts.has(cleanNorm)) {
                        delete taskEntries[taskKey];
                        cleanedTasks++;
                        changed = true;
                    }
                }
                if (Object.keys(taskEntries).length === 0) {
                    delete this.store.tasks[fileKey];
                    cleanedFiles++;
                    changed = true;
                }
            }

            if (this.store.headings && this.store.headings[fileKey]) {
                const headingEntries = this.store.headings[fileKey];
                for (const hText of Object.keys(headingEntries)) {
                    if (!existingHeadings.has(hText.toLowerCase())) {
                        delete headingEntries[hText];
                        changed = true;
                    }
                }
                if (Object.keys(headingEntries).length === 0) {
                    delete this.store.headings[fileKey];
                    changed = true;
                }
            }
        }

        if (changed) {
            this.invalidateSortCache();
            await this.flushStore();
        }
        return { cleanedTasks, cleanedFiles };
    }

    async cleanupExpiredTrackerTasks() {
        const trackerFiles = this.getAllTasksTrackerFiles();
        if (trackerFiles.length === 0) return;

        const todayStr = window.moment().format("YYYY-MM-DD");
        let storeChanged = false;

        for (const file of trackerFiles) {
            let content = "";
            try {
                content = await this.app.vault.cachedRead(file);
            } catch (e) {
                continue;
            }

            const lines = content.split("\n");
            const tree = this.buildTaskTree(lines);
            let hasDeletions = false;

            const shouldDeleteTrackerItem = (item) => {
                if (!item.isTask) return false;
                const cleanText = cleanTaskString(item.raw);
                const childTexts = item.children.map(c => cleanTaskString(c.raw));
                const contextKey = computeTaskKey(cleanText, [], childTexts);
                const data = this.getTaskData(file.basename, cleanText, { contextKey, childTexts });
                if (!data) return false;

                if (data.repeat) {
                    if (data.until && todayStr > data.until) {
                        return true;
                    }
                    return false;
                }

                if (data.until) {
                    return todayStr > data.until;
                }
                if (data.next) {
                    return todayStr > data.next;
                }
                return false;
            };

            const collectDeletedLineIndices = (nodes, deletedSet) => {
                for (const node of nodes) {
                    if (shouldDeleteTrackerItem(node)) {
                        hasDeletions = true;
                        const cleanText = cleanTaskString(node.raw);
                        const childTexts = node.children.map(c => cleanTaskString(c.raw));
                        const contextKey = computeTaskKey(cleanText, [], childTexts);
                        if (this.store.tasks && this.store.tasks[file.basename]) {
                            delete this.store.tasks[file.basename][contextKey];
                            delete this.store.tasks[file.basename][cleanText];
                            storeChanged = true;
                        }
                        const markSubtreeDeleted = (n) => {
                            if (typeof n.lineIndex === "number") {
                                deletedSet.add(n.lineIndex);
                            }
                            for (const c of n.children) {
                                markSubtreeDeleted(c);
                            }
                        };
                        markSubtreeDeleted(node);
                        continue;
                    }
                    collectDeletedLineIndices(node.children, deletedSet);
                }
            };

            const deletedLines = new Set();
            collectDeletedLineIndices(tree, deletedLines);

            if (hasDeletions && deletedLines.size > 0) {
                const newLines = [];
                for (let i = 0; i < lines.length; i++) {
                    if (!deletedLines.has(i)) {
                        newLines.push(lines[i]);
                    }
                }
                await this.app.vault.modify(file, newLines.join("\n"));
            }
        }

        if (storeChanged) {
            this.invalidateSortCache();
            await this.flushStore();
        }
    }

    async purgeTaskSchedules(options) {
        if (!this.store || !this.store.tasks) return { purgedTasks: 0, purgedNotes: 0 };

        let purgedTasks = 0;
        let purgedNotes = 0;
        let changed = false;

        const fileKeys = Object.keys(this.store.tasks);

        for (const fileKey of fileKeys) {
            const noteDate = parseNoteDateStrict(fileKey) || parseNoteDateFlexible(fileKey);
            if (!noteDate.isValid()) continue;

            let shouldPurge = false;
            if (options.mode === "before") {
                const cutoff = window.moment(options.beforeDate, "YYYY-MM-DD").startOf("day");
                if (cutoff.isValid() && noteDate.isBefore(cutoff, "day")) {
                    shouldPurge = true;
                }
            } else if (options.mode === "period") {
                const start = window.moment(options.rangeStart, "YYYY-MM-DD").startOf("day");
                const end = window.moment(options.rangeEnd, "YYYY-MM-DD").endOf("day");
                if (start.isValid() && end.isValid() && noteDate.isSameOrAfter(start, "day") && noteDate.isSameOrBefore(end, "day")) {
                    shouldPurge = true;
                }
            }

            if (shouldPurge) {
                const count = Object.keys(this.store.tasks[fileKey] || {}).length;
                delete this.store.tasks[fileKey];
                if (this.store.headings && this.store.headings[fileKey]) {
                    delete this.store.headings[fileKey];
                }
                purgedTasks += count;
                purgedNotes++;
                changed = true;
            }
        }

        if (changed) {
            this.invalidateSortCache();
            await this.flushStore();
            this.refreshOpenEditors();
        }

        return { purgedTasks, purgedNotes };
    }

    getAllTasksTrackerFiles() {
        const files = this.app.vault.getMarkdownFiles();
        const results = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (isTasksTrackerFile(f, this.app)) {
                results.push(f);
            }
        }
        return results;
    }

    async getTrackerDueTasksForDate(targetNoteTitle) {
        const noteDate = parseNoteDateFlexible(targetNoteTitle);
        const trackerFiles = this.getAllTasksTrackerFiles();
        const dueItems = [];

        for (let i = 0; i < trackerFiles.length; i++) {
            const file = trackerFiles[i];
            let content = "";
            try {
                content = await this.app.vault.cachedRead(file);
            } catch (e) {
                continue;
            }

            const lines = content.split("\n");
            const tree = this.buildTaskTree(lines);

            for (let j = 0; j < tree.length; j++) {
                const rootItem = tree[j];
                if (!rootItem.isTask) continue;
                const cleanText = cleanTaskString(rootItem.raw);
                const childTexts = rootItem.children.map(c => cleanTaskString(c.raw));
                const contextKey = computeTaskKey(cleanText, [], childTexts);
                const data = this.getTaskData(file.basename, cleanText, { contextKey, childTexts });

                let isDue = false;
                let weekdays = null;
                let startDate = null;
                if (data && !data.isCleared) {
                    startDate = data.start ? window.moment(data.start, "YYYY-MM-DD") : null;
                    const untilDate = data.until ? window.moment(data.until, "YYYY-MM-DD") : null;
                    const nextDate = data.next ? window.moment(data.next, "YYYY-MM-DD") : null;
                    weekdays = getWeekdaysFromData(data);

                    if (untilDate && noteDate.isAfter(untilDate, "day")) {
                        isDue = false;
                    } else if (startDate && noteDate.isBefore(startDate, "day")) {
                        isDue = false;
                    } else if (weekdays && weekdays.length > 0) {
                        isDue = weekdays.includes(noteDate.day());
                    } else if (data.repeat) {
                        const interval = parseInterval(data.repeat);
                        const isDaily = interval && interval.days === 1 && !interval.weeks && !interval.months && !interval.years;
                        if (isDaily) {
                            isDue = true;
                        } else if (nextDate) {
                            isDue = nextDate.isSame(noteDate, "day");
                        }
                    } else {
                        if (startDate && untilDate) {
                            isDue = noteDate.isSameOrAfter(startDate, "day") && noteDate.isSameOrBefore(untilDate, "day");
                        } else if (nextDate) {
                            isDue = nextDate.isSame(noteDate, "day");
                        }
                    }
                }

                if (isDue) {
                    const processed = this.filterTreeBySchedule(rootItem, targetNoteTitle, file.basename, null, []);
                    if (weekdays && weekdays.length > 0 && data) {
                        const nextMatching = getNextMatchingWeekdayDate(noteDate.clone().add(1, "days"), weekdays, startDate);
                        this.saveTaskData(targetNoteTitle, contextKey, {
                            ...data,
                            cleanText,
                            contextKey,
                            ancestorTexts: [],
                            childTexts,
                            weekdays,
                            next: nextMatching.format("YYYY-MM-DD")
                        });
                    }
                    dueItems.push({
                        cleanText,
                        contextKey,
                        lines: this.formatTaskTree(processed, true)
                    });
                }
            }
        }

        return dueItems;
    }

    async evaluateRollover(prevNoteTitle, currentNoteTitle, prevLines) {
        const prevNoteDate = parseNoteDateFlexible(prevNoteTitle);
        const noteDate = parseNoteDateFlexible(currentNoteTitle);

        const trackerDueItems = await this.getTrackerDueTasksForDate(currentNoteTitle);

        const trackerReplacementMap = new Map();
        for (let i = 0; i < trackerDueItems.length; i++) {
            const item = trackerDueItems[i];
            const key = item.cleanText.toLowerCase();
            if (!trackerReplacementMap.has(key)) {
                trackerReplacementMap.set(key, []);
            }
            trackerReplacementMap.get(key).push(item);
        }

        const tree = this.buildTaskTree(prevLines);
        const todayTasks = [];
        const plannedTasks = [];
        const seenContextKeys = new Set();
        const seenCleanTexts = new Set();

        const pushWithBlankHandling = (targetArray, lines) => {
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                if (l === "") {
                    if (targetArray.length > 0 && targetArray[targetArray.length - 1] !== "") {
                        targetArray.push("");
                    }
                } else {
                    targetArray.push(l);
                }
            }
        };

        for (let i = 0; i < tree.length; i++) {
            const rootItem = tree[i];
            if (rootItem.isBlank) {
                if (todayTasks.length > 0 && todayTasks[todayTasks.length - 1] !== "") {
                    todayTasks.push("");
                }
                if (plannedTasks.length > 0 && plannedTasks[plannedTasks.length - 1] !== "") {
                    plannedTasks.push("");
                }
                continue;
            }

            const rawLine = rootItem.raw;
            if (!rootItem.isTask) continue;

            const cleanText = cleanTaskString(rawLine);
            const lowerClean = cleanText.toLowerCase();
            const childTexts = rootItem.children.map(c => cleanTaskString(c.raw));
            const contextKey = computeTaskKey(cleanText, [], childTexts);
            const isChecked = CHECKED_LINE_RE.test(rawLine);

            let data = this.getTaskData(prevNoteTitle, cleanText, { contextKey, childTexts });
            if (!data) {
                data = extractLegacyBadgeInfo(rawLine, prevNoteDate);
            }

            const weekdays = getWeekdaysFromData(data);
            const trackerList = trackerReplacementMap.get(lowerClean);
            if (trackerList && trackerList.length > 0) {
                const exactIdx = trackerList.findIndex(item => item.contextKey === contextKey);
                if (exactIdx !== -1) {
                    const [replacement] = trackerList.splice(exactIdx, 1);
                    pushWithBlankHandling(todayTasks, replacement.lines);
                    seenContextKeys.add(replacement.contextKey);
                    seenCleanTexts.add(lowerClean);
                    continue;
                }
                if (data && (data.repeat || (weekdays && weekdays.length > 0) || isChecked)) {
                    const replacement = trackerList.shift();
                    pushWithBlankHandling(todayTasks, replacement.lines);
                    seenContextKeys.add(replacement.contextKey);
                    seenCleanTexts.add(lowerClean);
                    continue;
                }
            }

            if (data && data.fromTracker) {
                if (data.repeat || (weekdays && weekdays.length > 0) || isChecked || seenCleanTexts.has(lowerClean)) {
                    continue;
                }
            }

            const untilDate = data && data.until ? window.moment(data.until, "YYYY-MM-DD") : null;
            const startDate = data && data.start ? window.moment(data.start, "YYYY-MM-DD") : null;
            const isPeriodActive = data && data.start && data.until && noteDate.isSameOrBefore(untilDate, "day");

            if (isChecked && (!data || (!data.repeat && (!weekdays || weekdays.length === 0) && !isPeriodActive))) {
                continue;
            }

            const processedTree = this.filterTreeBySchedule(rootItem, currentNoteTitle, prevNoteTitle, null, []);

            if (!data || data.isCleared) {
                if (!isChecked) {
                    pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, false));
                    seenContextKeys.add(contextKey);
                    seenCleanTexts.add(lowerClean);
                }
                this.saveTaskData(currentNoteTitle, contextKey, { isCleared: true, cleanText });
                continue;
            }

            const interval = data.repeat ? parseInterval(data.repeat) : null;
            let targetDate = data.next ? window.moment(data.next, "YYYY-MM-DD") : null;

            if (untilDate && noteDate.isAfter(untilDate, "day")) {
                continue;
            }

            if (startDate && noteDate.isBefore(startDate, "day")) {
                if (!data.fromTracker) {
                    pushWithBlankHandling(plannedTasks, this.formatTaskTree(processedTree, true));
                }
                this.saveTaskData(currentNoteTitle, contextKey, data);
                continue;
            }

            if (weekdays && weekdays.length > 0) {
                const isDueToday = weekdays.includes(noteDate.day());
                if (isDueToday) {
                    pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, true));
                    seenContextKeys.add(contextKey);
                    seenCleanTexts.add(lowerClean);
                    const nextMatching = getNextMatchingWeekdayDate(noteDate.clone().add(1, "days"), weekdays, startDate);
                    this.saveTaskData(currentNoteTitle, contextKey, {
                        ...data,
                        weekdays,
                        next: nextMatching.format("YYYY-MM-DD")
                    });
                } else {
                    if (!data.fromTracker) {
                        pushWithBlankHandling(plannedTasks, this.formatTaskTree(processedTree, true));
                    }
                    this.saveTaskData(currentNoteTitle, contextKey, {
                        ...data,
                        weekdays
                    });
                }
                continue;
            }

            if (untilDate && startDate) {
                if (noteDate.isSameOrAfter(startDate, "day") && noteDate.isSameOrBefore(untilDate, "day")) {
                    pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, true));
                    seenContextKeys.add(contextKey);
                    seenCleanTexts.add(lowerClean);
                    this.saveTaskData(currentNoteTitle, contextKey, {
                        ...data,
                        next: noteDate.clone().add(1, "days").format("YYYY-MM-DD")
                    });
                    continue;
                }
            }

            const isDaily = interval && interval.days === 1 && !interval.weeks && !interval.months && !interval.years;
            if (isDaily) {
                const newStreak = isChecked ? (data.streak || 0) + 1 : 0;
                pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, true));
                seenContextKeys.add(contextKey);
                seenCleanTexts.add(lowerClean);
                this.saveTaskData(currentNoteTitle, contextKey, {
                    ...data,
                    next: noteDate.clone().add(1, "days").format("YYYY-MM-DD"),
                    streak: newStreak
                });
                continue;
            }

            if (!targetDate && interval) {
                targetDate = addToDate(prevNoteDate, interval);
            }

            if (targetDate) {
                const isDueToday = targetDate.isSameOrBefore(noteDate, "day");
                if (isDueToday) {
                    if (!interval && isChecked) {
                        continue;
                    }
                    pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, true));
                    seenContextKeys.add(contextKey);
                    seenCleanTexts.add(lowerClean);
                    if (interval) {
                        const nextAfterToday = addToDate(noteDate, interval);
                        this.saveTaskData(currentNoteTitle, contextKey, {
                            ...data,
                            next: nextAfterToday.format("YYYY-MM-DD")
                        });
                    } else {
                        this.saveTaskData(currentNoteTitle, contextKey, data);
                    }
                } else {
                    if (!data.fromTracker) {
                        pushWithBlankHandling(plannedTasks, this.formatTaskTree(processedTree, true));
                    }
                    this.saveTaskData(currentNoteTitle, contextKey, {
                        ...data,
                        next: targetDate.format("YYYY-MM-DD")
                    });
                }
            } else {
                if (!isChecked) {
                    pushWithBlankHandling(todayTasks, this.formatTaskTree(processedTree, false));
                    seenContextKeys.add(contextKey);
                    seenCleanTexts.add(lowerClean);
                    this.saveTaskData(currentNoteTitle, contextKey, data);
                }
            }
        }

        for (const [, items] of trackerReplacementMap.entries()) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!seenContextKeys.has(item.contextKey)) {
                    if (todayTasks.length > 0 && todayTasks[todayTasks.length - 1] !== "") {
                        todayTasks.push("");
                    }
                    pushWithBlankHandling(todayTasks, item.lines);
                    seenContextKeys.add(item.contextKey);
                    seenCleanTexts.add(item.cleanText.toLowerCase());
                }
            }
        }

        const cleanFinalArray = (arr) => {
            const cleaned = [];
            for (let i = 0; i < arr.length; i++) {
                const line = arr[i];
                if (line === "") {
                    if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== "") {
                        cleaned.push("");
                    }
                } else {
                    cleaned.push(line);
                }
            }
            while (cleaned.length > 0 && cleaned[0] === "") cleaned.shift();
            while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();
            return cleaned;
        };

        const finalToday = cleanFinalArray(todayTasks);
        const finalPlanned = cleanFinalArray(plannedTasks);

        await this.flushStore();

        return {
            todayTasks: finalToday.length > 0 ? finalToday.join("\n") : "- [ ] ",
            plannedTasks: finalPlanned.length > 0 ? finalPlanned.join("\n") : "- [ ] "
        };
    }

    async getRolloverContent(type, tpTitle) {
        let resolvedTitle = tpTitle;
        if (resolvedTitle && typeof resolvedTitle === "object") {
            resolvedTitle = resolvedTitle.file?.title || resolvedTitle.title || null;
        }
        const currentTitle = resolvedTitle || (this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().basename : window.moment().format("YYYY-MM-DD"));

        if (this._rolloverCache && this._rolloverCache.title === currentTitle && (Date.now() - this._rolloverCache.time) < 3000) {
            return type === "tasks" ? this._rolloverCache.result.todayTasks : this._rolloverCache.result.plannedTasks;
        }

        const noteDate = parseNoteDateFlexible(currentTitle);
        const allFiles = this.app.vault.getMarkdownFiles();
        const dateFiles = [];
        for (let i = 0; i < allFiles.length; i++) {
            const f = allFiles[i];
            if (f.basename === currentTitle) continue;
            if (!isDailyNoteFile(f, this.app, this.store.settings.folderOverride)) continue;
            const m = parseNoteDateFlexible(f.basename);
            if (m.isValid() && m.isBefore(noteDate, "day")) {
                dateFiles.push({ file: f, date: m });
            }
        }

        dateFiles.sort((a, b) => b.date.valueOf() - a.date.valueOf());
        const prevFile = dateFiles.length > 0 ? dateFiles[0].file : null;

        if (!prevFile) {
            const trackerDueItems = await this.getTrackerDueTasksForDate(currentTitle);
            const lines = [];
            for (let i = 0; i < trackerDueItems.length; i++) lines.push(...trackerDueItems[i].lines);
            const result = {
                todayTasks: lines.length > 0 ? lines.join("\n") : "- [ ] ",
                plannedTasks: "- [ ] "
            };
            this._rolloverCache = { title: currentTitle, time: Date.now(), result };
            await this.flushStore();
            return type === "tasks" ? result.todayTasks : result.plannedTasks;
        }

        const content = await this.app.vault.cachedRead(prevFile);
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

        for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
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
            for (let i = 0; i < lines.length; i++) {
                if (TASK_LINE_RE.test(lines[i])) {
                    allPreviousTaskLines.push(lines[i]);
                }
            }
        }

        const rollover = await this.evaluateRollover(prevFile.basename, currentTitle, allPreviousTaskLines);
        this._rolloverCache = { title: currentTitle, time: Date.now(), result: rollover };
        return type === "tasks" ? rollover.todayTasks : rollover.plannedTasks;
    }

    requestScan(editor, fileKey) {
        if (this.scanTimeout) clearTimeout(this.scanTimeout);
        this.scanTimeout = setTimeout(async () => {
            await this.scanAndProcessDocument(editor, fileKey);
        }, 400);
    }

    async scanAndProcessDocument(editor, fileKey) {
        const lineCount = editor.lineCount();
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = activeView?.file;
        const isTracker = file ? isTasksTrackerFile(file, this.app) : false;
        const noteDate = isTracker ? window.moment() : parseNoteDateFlexible(fileKey);
        const updates = [];

        const lines = new Array(lineCount);
        for (let i = 0; i < lineCount; i++) {
            const text = editor.getLine(i);
            const isTask = TASK_LINE_RE.test(text);
            const isHeading = !isTask && HEADING_LINE_RE.test(text);
            const indentMatch = text.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;
            lines[i] = { lineNum: i, text, isTask, isHeading, indent };
        }

        for (let i = 0; i < lineCount; i++) {
            const item = lines[i];
            if (!item.isTask && !item.isHeading) continue;

            const cleanItemText = item.text.replace(/\r/g, "");
            const match = cleanItemText.match(TAG_END_RE);
            if (match) {
                const beforeMatch = cleanItemText.slice(0, match.index);
                if (((beforeMatch.match(/`/g) || []).length % 2) !== 0) continue;

                const rawTag = match[1].trim();
                const cleanLine = cleanItemText.replace(TAG_END_RE, "").trimEnd();

                const ancestorTexts = [];
                const childTexts = [];

                if (item.isTask) {
                    let curIndent = item.indent;
                    for (let p = i - 1; p >= 0; p--) {
                        if (lines[p].isTask && lines[p].indent < curIndent) {
                            ancestorTexts.unshift(cleanTaskString(lines[p].text));
                            curIndent = lines[p].indent;
                            if (curIndent === 0) break;
                        }
                    }

                    let directChildIndent = -1;
                    for (let c = i + 1; c < lineCount; c++) {
                        if (lines[c].indent <= item.indent) break;
                        if (lines[c].isTask) {
                            if (directChildIndent === -1) directChildIndent = lines[c].indent;
                            if (lines[c].indent === directChildIndent) {
                                childTexts.push(cleanTaskString(lines[c].text));
                            }
                        }
                    }
                }

                updates.push({
                    lineNum: i,
                    newText: cleanLine,
                    rawTag,
                    isHeading: item.isHeading,
                    isTask: item.isTask,
                    ancestorTexts,
                    childTexts
                });
            }
        }

        if (updates.length > 0) {
            let needsAutoCheck = false;
            for (const u of updates) {
                if (u.isHeading) {
                    const headingText = cleanHeadingString(u.newText);
                    if (/^(clear|remove|delete|none|reset|cancel|stop)$/i.test(u.rawTag)) {
                        await this.deleteHeadingType(fileKey, headingText);
                    } else {
                        const headingType = this.normalizeHeadingType(u.rawTag);
                        if (headingType) await this.saveHeadingType(fileKey, headingText, headingType);
                    }
                } else if (u.isTask) {
                    const cleanText = cleanTaskString(u.newText);
                    const tempParsed = parseTaskTag(u.rawTag, noteDate, null);
                    const tempNext = tempParsed.explicitNextDate ? tempParsed.explicitNextDate.format("YYYY-MM-DD") : null;
                    const taskKey = computeTaskKey(cleanText, u.ancestorTexts, u.childTexts, isTracker ? tempNext : null);
                    const existing = this.getTaskData(fileKey, cleanText, { contextKey: taskKey, ancestorTexts: u.ancestorTexts, childTexts: u.childTexts }) || {};
                    const parsed = parseTaskTag(u.rawTag, noteDate, existing);

                    if (parsed.isClear) {
                        this.deleteTaskData(fileKey, taskKey, cleanText);
                        needsAutoCheck = true;
                    } else {
                        const repeat = parsed.explicitRepeat !== null ? parsed.explicitRepeat : (existing.repeat || null);
                        const orig = parsed.explicitOrigDate ? parsed.explicitOrigDate.format("YYYY-MM-DD") : (existing.orig || (isTracker ? noteDate.format("YYYY-MM-DD") : null));
                        const start = parsed.explicitStartDate ? parsed.explicitStartDate.format("YYYY-MM-DD") : (existing.start || null);
                        const until = parsed.explicitUntilDate ? parsed.explicitUntilDate.format("YYYY-MM-DD") : (existing.until || null);
                        const isOptional = parsed.hasExplicitOptional ? parsed.isOptional : (existing.isOptional || false);
                        const streak = existing.streak || 0;
                        const weekdays = parsed.explicitWeekdays || existing.weekdays || null;

                        if (parsed.hasExplicitOptional) {
                            needsAutoCheck = true;
                        }

                        let nextStr = null;
                        if (parsed.explicitNextDate) {
                            nextStr = parsed.explicitNextDate.format("YYYY-MM-DD");
                        } else if (start && window.moment(start, "YYYY-MM-DD").isAfter(noteDate, "day")) {
                            nextStr = start;
                        } else if (existing.next && !parsed.explicitRepeat) {
                            nextStr = existing.next;
                        } else if (parsed.explicitInterval) {
                            if (parsed.explicitInterval.days === 1 && !parsed.explicitInterval.weeks && !parsed.explicitInterval.months && !parsed.explicitInterval.years) {
                                nextStr = noteDate.clone().add(1, "days").format("YYYY-MM-DD");
                            } else {
                                nextStr = addToDate(noteDate, parsed.explicitInterval).format("YYYY-MM-DD");
                            }
                        }

                        this.saveTaskData(fileKey, taskKey, {
                            cleanText,
                            contextKey: taskKey,
                            ancestorTexts: u.ancestorTexts,
                            childTexts: u.childTexts,
                            repeat,
                            next: nextStr,
                            orig,
                            start,
                            until,
                            isOptional,
                            streak,
                            weekdays,
                            rawTag: u.rawTag,
                            fromTracker: isTracker ? fileKey : (existing.fromTracker || null)
                        });
                    }
                }
            }

            this.isInternalEditorUpdate = true;
            for (const u of updates) {
                if (editor.getLine(u.lineNum) !== u.newText) {
                    editor.setLine(u.lineNum, u.newText);
                }
            }
            this.isInternalEditorUpdate = false;

            if (needsAutoCheck) {
                this.autoCheckParentTasks(editor, fileKey);
            }
            this.updateFileSnapshot(editor, fileKey);
            this.refreshOpenEditors();
        }
    }

    autoCheckParentTasks(editor, fileKey) {
        const lineCount = editor.lineCount();
        const lines = new Array(lineCount);
        const ancestorStack = [];

        for (let i = 0; i < lineCount; i++) {
            const text = editor.getLine(i);
            const isTask = TASK_LINE_RE.test(text);
            const indentMatch = text.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

            while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
                ancestorStack.pop();
            }

            if (!isTask) {
                lines[i] = { lineNum: i, isTask: false, indent };
                continue;
            }

            const cleanText = cleanTaskString(text);
            const ancestorTexts = ancestorStack.map(a => a.cleanText);
            ancestorStack.push({ indent, cleanText });

            lines[i] = {
                lineNum: i,
                text,
                isTask: true,
                isChecked: CHECKED_LINE_RE.test(text),
                isOptional: INLINE_OPTIONAL_RE.test(text),
                cleanText,
                ancestorTexts,
                indent
            };
        }

        const updates = [];

        for (let i = lineCount - 1; i >= 0; i--) {
            const parent = lines[i];
            if (!parent.isTask) continue;

            let total = 0;
            let completed = 0;
            let directIndent = -1;
            const childTexts = [];

            for (let j = i + 1; j < lineCount; j++) {
                const child = lines[j];
                if (child.indent <= parent.indent) break;
                if (!child.isTask) continue;

                if (directIndent === -1) {
                    directIndent = child.indent;
                }

                if (child.indent === directIndent) {
                    childTexts.push(child.cleanText);
                    if (!child.isOptional) {
                        total++;
                        if (child.isChecked) completed++;
                    }
                }
            }

            if (!parent.isOptional) {
                const data = this.getTaskData(fileKey, parent.cleanText, {
                    ancestorTexts: parent.ancestorTexts,
                    childTexts
                });
                if (data && data.isOptional) {
                    parent.isOptional = true;
                }
            }

            if (total > 0) {
                const shouldBeChecked = (completed === total);
                if (shouldBeChecked !== parent.isChecked) {
                    parent.isChecked = shouldBeChecked;
                    const newText = parent.text.replace(/^(\s*-\s*\[).(\])/, shouldBeChecked ? "$1x$2" : "$1 $2");
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
            this.updateFileSnapshot(editor, fileKey);
        }
    }

    processProgressBars(container, sourcePath) {
        const fileKey = sourcePath ? sourcePath.split("/").pop().replace(".md", "") : "";
        let isDailyOrTracker = false;
        let noteDateStr = null;

        if (fileKey && sourcePath) {
            const abstractFile = this.app.vault.getAbstractFileByPath(sourcePath);
            if (abstractFile && isPeriodicOrDailyNote(abstractFile, this.app, this.store.settings.folderOverride)) {
                isDailyOrTracker = true;
                const isTracker = isTasksTrackerFile(abstractFile, this.app);
                noteDateStr = (isTracker ? window.moment() : parseNoteDateFlexible(fileKey)).format("YYYY-MM-DD");
            }
        }

        const listItems = container.querySelectorAll("li");
        for (const li of listItems) {
            const liText = extractDirectTextContent(li);
            const liClean = cleanTaskString(liText);
            const ancestorTexts = isDailyOrTracker ? collectDomAncestorTaskTexts(li) : [];
            const nestedUl = li.querySelector(":scope > ul, :scope > ol");
            const childTexts = [];

            if (nestedUl) {
                const childLis = nestedUl.querySelectorAll(":scope > li");
                let total = 0;
                let completed = 0;

                for (const cLi of childLis) {
                    const cText = extractDirectTextContent(cLi);
                    const cClean = cleanTaskString(cText);
                    childTexts.push(cClean);
                    let isOptional = INLINE_OPTIONAL_RE.test(cText);
                    if (!isOptional && isDailyOrTracker) {
                        const cAncestors = [...ancestorTexts, liClean];
                        const cChildren = collectDomChildTaskTexts(cLi);
                        const data = this.getTaskData(fileKey, cClean, { ancestorTexts: cAncestors, childTexts: cChildren });
                        if (data && data.isOptional) isOptional = true;
                    }

                    const cb = cLi.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
                    if (cb && !isOptional) {
                        total++;
                        if (cb.checked) completed++;
                    }
                    if (isOptional) {
                        cLi.classList.add("task-optional-item");
                    }
                }

                if (total > 0) {
                    const percent = Math.round((completed / total) * 100);
                    const existingBadge = li.querySelector(":scope > .task-progress-badge, :scope > p > .task-progress-badge");
                    if (existingBadge) existingBadge.remove();

                    const badge = document.createElement("span");
                    badge.className = "task-progress-badge";

                    const circumference = 2 * Math.PI * 5.5;
                    const strokeDash = (percent / 100) * circumference;

                    badge.innerHTML = `
                        <svg class="task-progress-ring" viewBox="0 0 16 16">
                            <circle class="task-progress-ring-bg" cx="8" cy="8" r="5.5"></circle>
                            <circle class="task-progress-ring-fill ${percent === 100 ? "complete" : ""}" cx="8" cy="8" r="5.5" stroke-dasharray="${strokeDash} ${circumference}"></circle>
                        </svg>
                        <span class="task-progress-count">${percent}% (${completed}/${total})</span>
                    `;

                    const isTopLevel = !li.parentElement.closest("li");
                    const firstP = li.querySelector(":scope > p, :scope > span:not(.task-progress-badge)");
                    if (firstP) {
                        if (isTopLevel) firstP.classList.add("task-top-parent-goal");
                        firstP.appendChild(badge);
                    } else {
                        const inlineNodes = [];
                        for (const child of Array.from(li.childNodes)) {
                            if (child === nestedUl) break;
                            if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "INPUT") continue;
                            inlineNodes.push(child);
                        }
                        if (inlineNodes.length > 0) {
                            const wrapper = document.createElement("span");
                            if (isTopLevel) wrapper.className = "task-top-parent-goal";
                            li.insertBefore(wrapper, inlineNodes[0]);
                            for (const n of inlineNodes) {
                                wrapper.appendChild(n);
                            }
                            wrapper.insertAdjacentElement("afterend", badge);
                        } else if (nestedUl) {
                            li.insertBefore(badge, nestedUl);
                        } else {
                            li.appendChild(badge);
                        }
                    }
                }
            }

            if (isDailyOrTracker) {
                const data = this.getTaskData(fileKey, liClean, { ancestorTexts, childTexts });
                if (INLINE_OPTIONAL_RE.test(liText) || (data && data.isOptional)) {
                    li.classList.add("task-optional-item");
                }
                const cb = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
                if (cb && !cb.checked && data && isTaskOverdue(data, noteDateStr)) {
                    li.classList.add("task-overdue-item");
                }
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
        this.requestSaveStore();
    }

    async deleteHeadingType(fileKey, headingText) {
        const h = headingText.toLowerCase();
        if (this.store.headings && this.store.headings[fileKey] && this.store.headings[fileKey][h]) {
            delete this.store.headings[fileKey][h];
            this.requestSaveStore();
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

    requestSaveStore() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(async () => {
            this._saveTimeout = null;
            await this.saveData(this.store);
        }, 500);
    }

    async flushStore() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }
        await this.saveData(this.store);
    }

    saveTaskData(fileKey, taskKey, data) {
        if (!this.store.tasks) this.store.tasks = {};
        if (!this.store.tasks[fileKey]) this.store.tasks[fileKey] = {};

        const clean = data.cleanText || cleanTaskString(taskKey);
        const cleanNorm = normalizeForMatching(clean);
        const isDatedDaily = !!parseNoteDateStrict(fileKey);
        const targetAnc = (data.ancestorTexts || []).join("\0");
        const targetChild = (data.childTexts || []).join("\0");

        for (const k of Object.keys(this.store.tasks[fileKey])) {
            if (k === taskKey) continue;
            const entry = this.store.tasks[fileKey][k];
            if (!entry) continue;
            const entryClean = entry.cleanText || cleanTaskString(k);
            const sameClean = entryClean === clean || normalizeForMatching(entryClean) === cleanNorm;
            if (!sameClean) continue;

            if (entry.isCleared) {
                delete this.store.tasks[fileKey][k];
            } else if (isDatedDaily && (entry.ancestorTexts || []).join("\0") === targetAnc && (entry.childTexts || []).join("\0") === targetChild) {
                delete this.store.tasks[fileKey][k];
            }
        }

        this.store.tasks[fileKey][taskKey] = data;
        this.invalidateSortCache(fileKey);
        this.requestSaveStore();
    }

    deleteTaskData(fileKey, taskKey, cleanText = null) {
        const activeFile = this.app.workspace.getActiveFile()?.basename === fileKey
            ? this.app.workspace.getActiveFile()
            : this.app.vault.getMarkdownFiles().find(f => f.basename === fileKey);
        const isTracker = isTasksTrackerFile(activeFile, this.app);

        if (this.store.tasks && this.store.tasks[fileKey]) {
            const clean = cleanText || cleanTaskString(taskKey);
            const targetCleanNorm = normalizeForMatching(clean);

            for (const k of Object.keys(this.store.tasks[fileKey])) {
                const entry = this.store.tasks[fileKey][k];
                const entryClean = entry?.cleanText || cleanTaskString(k);
                const kWithoutPrefix = k.includes(" > ") ? k.split(" > ").pop().trim() : k;
                const kClean = cleanTaskString(kWithoutPrefix);

                const isMatch = k === taskKey ||
                                k === clean ||
                                entryClean === clean ||
                                kClean === clean ||
                                normalizeForMatching(entryClean) === targetCleanNorm ||
                                normalizeForMatching(kClean) === targetCleanNorm ||
                                k.endsWith(` > ${clean}`);

                if (isMatch) {
                    delete this.store.tasks[fileKey][k];
                }
            }

            if (!isTracker) {
                this.store.tasks[fileKey][clean] = { isCleared: true, cleanText: clean };
                if (taskKey && taskKey !== clean) {
                    this.store.tasks[fileKey][taskKey] = { isCleared: true, cleanText: clean, contextKey: taskKey };
                }
            }
        }
        this.invalidateSortCache(fileKey);
        this.requestSaveStore();
    }

    invalidateSortCache(fileKey = null) {
        if (fileKey) {
            this._fileIndexCache.delete(fileKey);
        } else {
            this._fileIndexCache.clear();
        }
        this._cachedSortedFiles = null;
        this._globalDateIndex = null;
        this._getTaskDataCache.clear();
        this._rolloverCache = null;
        this.storeVersion++;
    }

    getSortedDailyFileEntries() {
        if (this._cachedSortedFiles) return this._cachedSortedFiles;
        if (!this.store.tasks) return [];

        const entries = [];
        for (const f of Object.keys(this.store.tasks)) {
            const d = parseNoteDateStrict(f);
            if (d) {
                entries.push({ name: f, date: d, dayVal: d.clone().startOf("day").valueOf() });
            }
        }
        entries.sort((a, b) => b.dayVal - a.dayVal);
        this._cachedSortedFiles = entries;
        return entries;
    }

    buildFileIndex(fileKey) {
        if (this._fileIndexCache.has(fileKey)) {
            return this._fileIndexCache.get(fileKey);
        }
        const map = this.store.tasks?.[fileKey];
        if (!map) {
            const empty = { byNormClean: new Map(), map: null };
            this._fileIndexCache.set(fileKey, empty);
            return empty;
        }

        const byNormClean = new Map();
        for (const [k, entry] of Object.entries(map)) {
            if (!entry) continue;
            const entryClean = entry.cleanText || cleanTaskString(k);
            const kWithoutPrefix = k.includes(" > ") ? k.split(" > ").pop().trim() : k;
            const kClean = cleanTaskString(kWithoutPrefix);
            const normEntry = normalizeForMatching(entryClean);
            const normK = normalizeForMatching(kClean);

            const indexed = { key: k, entry, entryClean, kClean, normEntry, normK };
            if (!byNormClean.has(normEntry)) byNormClean.set(normEntry, []);
            byNormClean.get(normEntry).push(indexed);

            if (normK !== normEntry) {
                if (!byNormClean.has(normK)) byNormClean.set(normK, []);
                byNormClean.get(normK).push(indexed);
            }
        }

        const result = { byNormClean, map };
        this._fileIndexCache.set(fileKey, result);
        return result;
    }

    matchTaskInFile(fileKey, cleanText, contextKey, ancestorTexts = [], childTexts = [], targetDate = null) {
        const index = this.buildFileIndex(fileKey);
        if (!index.map) return null;
        const targetNorm = normalizeForMatching(cleanText);
        const candidates = index.byNormClean.get(targetNorm);
        if (!candidates || candidates.length === 0) {
            if (contextKey && index.map[contextKey]) return index.map[contextKey];
            if (index.map[cleanText]) return index.map[cleanText];
            return null;
        }
        return scoreTaskCandidates(candidates, index.map, cleanText, targetNorm, contextKey, ancestorTexts, childTexts, targetDate);
    }

    buildGlobalDateIndex() {
        if (this._globalDateIndex) return this._globalDateIndex;
        const globalByNorm = new Map();
        const sortedFiles = this.getSortedDailyFileEntries();

        for (let i = 0; i < sortedFiles.length; i++) {
            const fileItem = sortedFiles[i];
            const fileIndex = this.buildFileIndex(fileItem.name);
            for (const normKey of fileIndex.byNormClean.keys()) {
                if (!globalByNorm.has(normKey)) {
                    globalByNorm.set(normKey, []);
                }
                globalByNorm.get(normKey).push({
                    fileKey: fileItem.name,
                    dayVal: fileItem.dayVal
                });
            }
        }

        this._globalDateIndex = globalByNorm;
        return globalByNorm;
    }

    getTaskData(fileKey, taskText, context = {}) {
        const contextKey = context.contextKey || computeTaskKey(taskText, context.ancestorTexts, context.childTexts, context.dateStr);
        const cacheKey = `${fileKey}\0${taskText}\0${contextKey}\0${context.dateStr || ""}`;
        if (this._getTaskDataCache.has(cacheKey)) {
            return this._getTaskDataCache.get(cacheKey);
        }

        const strictNoteDate = parseNoteDateStrict(fileKey);
        const noteDate = strictNoteDate || parseNoteDateFlexible(fileKey);
        const noteDateStr = noteDate.format("YYYY-MM-DD");
        const nextDayStr = noteDate.clone().add(1, "days").format("YYYY-MM-DD");

        if (this.store.tasks && this.store.tasks[fileKey]) {
            const currentData = this.matchTaskInFile(fileKey, taskText, contextKey, context.ancestorTexts, context.childTexts, context.dateStr);
            if (currentData) {
                let res = currentData;
                if (currentData.isCleared) {
                    res = null;
                } else if (currentData.repeat && DAILY_REPEAT_RE.test(currentData.repeat)) {
                    if (!currentData.start || noteDateStr >= currentData.start) {
                        res = { ...currentData, next: nextDayStr };
                    }
                }
                this._getTaskDataCache.set(cacheKey, res);
                return res;
            }
        }

        if (!strictNoteDate) {
            this._getTaskDataCache.set(cacheKey, null);
            return null;
        }

        const noteDayVal = strictNoteDate.clone().startOf("day").valueOf();
        const targetNorm = normalizeForMatching(taskText);
        const globalIndex = this.buildGlobalDateIndex();
        const fileList = globalIndex.get(targetNorm);

        if (fileList) {
            for (let i = 0; i < fileList.length; i++) {
                const item = fileList[i];
                if (item.dayVal > noteDayVal) continue;
                const matched = this.matchTaskInFile(item.fileKey, taskText, contextKey, context.ancestorTexts, context.childTexts, context.dateStr);
                if (matched) {
                    let res = null;
                    if (matched.isCleared) {
                        res = null;
                    } else if (matched.fromTracker && item.fileKey !== fileKey) {
                        res = null;
                    } else {
                        res = { ...matched };
                        if (res.repeat && DAILY_REPEAT_RE.test(res.repeat)) {
                            if (!res.start || noteDateStr >= res.start) {
                                res.next = nextDayStr;
                            }
                        }
                    }
                    this._getTaskDataCache.set(cacheKey, res);
                    return res;
                }
            }
        }

        this._getTaskDataCache.set(cacheKey, null);
        return null;
    }

    buildTaskTree(lines) {
        const root = [];
        const stack = [];
        let lastWasBlank = false;

        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            if (!line.trim()) {
                if (!lastWasBlank && root.length > 0) {
                    root.push({ raw: "", isBlank: true, indentLevel: 0, isTask: false, lineIndex: idx, children: [] });
                    lastWasBlank = true;
                    stack.length = 0;
                }
                continue;
            }
            lastWasBlank = false;
            const indentMatch = line.match(/^(\s*)/);
            const indentStr = indentMatch ? indentMatch[1] : "";
            const indentLevel = indentStr.replace(/\t/g, "    ").length;

            const isTask = TASK_LINE_RE.test(line);
            const item = {
                raw: line,
                isTask,
                isBlank: false,
                indentLevel,
                lineIndex: idx,
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
        if (item.isBlank) return [""];
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

    filterTreeBySchedule(item, currentNoteTitle, prevNoteTitle, parentSchedule, ancestorTexts = []) {
        const noteDate = parseNoteDateFlexible(currentNoteTitle);
        const noteDateStr = noteDate.format("YYYY-MM-DD");
        const cleanText = cleanTaskString(item.raw);
        const childTexts = item.children.map(c => cleanTaskString(c.raw));
        const contextKey = computeTaskKey(cleanText, ancestorTexts, childTexts);

        const ownData = this.getTaskData(prevNoteTitle, cleanText, { contextKey, ancestorTexts, childTexts });
        let data = ownData || parentSchedule;

        let isDueToday = true;
        if (data) {
            const interval = data.repeat ? parseInterval(data.repeat) : null;
            const isDaily = interval && interval.days === 1 && !interval.weeks && !interval.months && !interval.years && !data.weekdays;
            const startDate = data.start ? window.moment(data.start, "YYYY-MM-DD") : null;
            const untilDate = data.until ? window.moment(data.until, "YYYY-MM-DD") : null;
            if (isDaily && (!startDate || noteDate.isSameOrAfter(startDate, "day"))) {
                data = { ...data, next: noteDate.clone().add(1, "days").format("YYYY-MM-DD") };
            }
            if (ownData) {
                this.saveTaskData(currentNoteTitle, contextKey, {
                    ...data,
                    cleanText,
                    contextKey,
                    ancestorTexts,
                    childTexts
                });
            }
            if (untilDate && noteDate.isAfter(untilDate, "day")) {
                isDueToday = false;
            } else if (startDate && noteDate.isBefore(startDate, "day")) {
                isDueToday = false;
            } else if (data.next) {
                isDueToday = isIsoDateStr(data.next)
                    ? data.next <= noteDateStr
                    : window.moment(data.next, "YYYY-MM-DD").isSameOrBefore(noteDate, "day");
            }
        }

        const nextAncestors = [...ancestorTexts, cleanText];
        const filteredChildren = [];
        for (const child of item.children) {
            const childResult = this.filterTreeBySchedule(child, currentNoteTitle, prevNoteTitle, data, nextAncestors);
            if (childResult) filteredChildren.push(childResult);
        }

        return {
            ...item,
            data,
            isDueToday,
            children: filteredChildren
        };
    }

    onunload() {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
            this.saveData(this.store);
        }
        if (this.cleanupTimer) {
            window.clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.tooltipManager) {
            this.tooltipManager.destroy();
        }
        delete window.tasks;
        delete window.TaskSchedulerAPI;
    }
};