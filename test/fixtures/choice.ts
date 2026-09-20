import { askChoice, closePrompts } from '../../src/lib/prompt';

const picked = await askChoice('Networks', ['Indoors', 'Outdoors', 'Garage'], ['Outdoors']);
console.log(`picked: ${picked.join(',')}`);
closePrompts();
