import chalk from 'chalk';

export class LoggerService {
    constructor(private readonly classFn: any) {}

    info(body: string) {
        console.log(chalk.green(`${this.classFn.name} (${new Date().getUTCDate()}): ${body}`));
    }

    error(body: string) {
        console.error(chalk.red(`${this.classFn.name} (${new Date().getUTCDate()}): ${body}`));
    }
}
