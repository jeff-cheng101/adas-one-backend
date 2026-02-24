export default class DateBuilder {
    private date: Date;

    constructor(date?: Date) {
        this.date = date || new Date();
    }

    moveDay(moveDays: number) {
        let d = new Date(this.date);
        d.setDate(d.getDate() + moveDays);
        this.date = d;
        return this;
    }

    moveMonth(moveMonths: number) {
        let d = new Date(this.date);
        d.setMonth(d.getMonth() + moveMonths);
        this.date = d;
        return this;
    }

    setBeginOfTheDay() {
        let d = new Date(this.date)
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        this.date = d;
        return this;
    }

    setEndOfTheDay() {
        let d = new Date(this.date)
        d.setHours(23);
        d.setMinutes(59);
        d.setSeconds(59);
        d.setMilliseconds(999);
        this.date = d;
        return this;
    }

    setBeginOfTheWeek() {
        let d = new Date(this.date);
        let weekday = d.getDay();
        d.setDate(d.getDate() - weekday);
        this.date = d;
        return this.setBeginOfTheDay();
    }

    setEndOfTheWeek() {
        let d = new Date(this.date);
        let weekday = d.getDay();
        d.setDate(d.getDate() + (7 - (weekday + 1)));
        this.date = d;
        return this.setEndOfTheDay();
    }

    setBeginOfTheMonth() {
        let d = new Date(this.date);
        d.setDate(1);
        this.date = d;
        return this.setBeginOfTheDay();
    }

    setEndOfTheMonth() {
        let d = new Date(this.date);
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
        this.date = d;
        return this.setEndOfTheDay();
    }

    build() {
        return this.date;
    }
}
