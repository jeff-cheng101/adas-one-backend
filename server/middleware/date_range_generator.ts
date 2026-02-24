import DateBuilder from './date_builder';

export function dailyReportRange(reportDate = new Date()) {
    const startTime = new DateBuilder(reportDate)
        .moveDay(-1)
        .setBeginOfTheDay()
        .build();
    const endTime = new DateBuilder(startTime)
        .setEndOfTheDay()
        .build();
    return { startTime, endTime };
}

export function weeklyReportRange(weekDayOffset = 0, reportDate = new Date()) { 
    const dateInStandbyReportWeek = new DateBuilder(reportDate)
        .moveDay(- weekDayOffset)
        .build();
    const startTime = new DateBuilder(dateInStandbyReportWeek)
        .setBeginOfTheWeek()
        .moveDay(-7)
        .moveDay(weekDayOffset)
        .setBeginOfTheDay()
        .build();
    const endTime = new DateBuilder(startTime)
        .moveDay(+6)
        .setEndOfTheDay()
        .build();
    return {startTime, endTime};
}

export function monthlyReportRange(monthDayOffset = 0, reportDate = new Date()) { 
    let startTime: Date;
    let endTime: Date;
    if (monthDayOffset >= 0) {
        const dateInStandbyReportMonth = new DateBuilder(reportDate)
            .moveDay(- monthDayOffset)
            .build();
        const standbyMonth1th = new DateBuilder(dateInStandbyReportMonth)
            .setBeginOfTheMonth()
            .build();
        const startMonth1th = new DateBuilder(standbyMonth1th)
            .moveMonth(-1)
            .build();
        const startMonthMaxDays = new DateBuilder(startMonth1th)
            .setEndOfTheMonth()
            .build()
            .getDate();
        const standbyMonthMaxDays = new DateBuilder(standbyMonth1th)
            .setEndOfTheMonth()
            .build()
            .getDate();
        startTime = new DateBuilder(startMonth1th)
            .moveDay(monthDayOffset > startMonthMaxDays - 1 ? startMonthMaxDays - 1 : monthDayOffset)
            .setBeginOfTheDay()
            .build();
        endTime = new DateBuilder(standbyMonth1th)
            .moveDay(monthDayOffset > standbyMonthMaxDays - 1 ? standbyMonthMaxDays - 1 : monthDayOffset)
            .moveDay(-1)
            .setEndOfTheDay()
            .build();
    } else { 
        const currentMonthMaxDays = new Date(reportDate.getFullYear(), reportDate.getMonth() + 1, 0).getDate();
        const dateInStandbyReportMonth = new DateBuilder(reportDate)
            .moveDay(- (currentMonthMaxDays + monthDayOffset))
            .build();
        const standbyMonth1th = new DateBuilder(dateInStandbyReportMonth)
            .setBeginOfTheMonth()
            .build();
        const startMonth1th = new DateBuilder(standbyMonth1th)
            .moveMonth(-1)
            .build();
        const startMonthMaxDays = new DateBuilder(startMonth1th)
            .setEndOfTheMonth()
            .build()
            .getDate();
        const standbyMonthMaxDays = new DateBuilder(standbyMonth1th)
            .setEndOfTheMonth()
            .build()
            .getDate();
        startTime = new DateBuilder(startMonth1th)
            .moveMonth(1)
            .moveDay(monthDayOffset < - startMonthMaxDays ? - startMonthMaxDays : monthDayOffset)
            .setBeginOfTheDay()
            .build();
        endTime = new DateBuilder(standbyMonth1th)
            .moveMonth(1)
            .moveDay(monthDayOffset < - standbyMonthMaxDays ? - standbyMonthMaxDays - 1 : monthDayOffset - 1)
            .setEndOfTheDay()
            .build();
    }
    return { startTime, endTime };
}

export default {
    dailyReportRange,
    weeklyReportRange,
    monthlyReportRange,
}