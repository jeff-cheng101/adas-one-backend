// @ts-ignore
import qrate from 'qrate';
import chalk from 'chalk';

const catchHandler = (e: any) => {
    console.log(chalk.red(e.stack));
}

export const series = qrate((fn: any, done: any) => {

    fn().then(() => {
        done();
    })
    .catch((e: any) => {
        catchHandler(e);
        done();
    });
});

export const txSeries = qrate((fn: any, done: any) => {

    fn().then(() => {
        done();
    })
    .catch((e: any) => {
        catchHandler(e);
        done();
    });
});