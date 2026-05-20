import { createSlideStage } from '@slidestage/core/createSlideStage';
import { litePreset } from '@slidestage/lite-preset/litePreset';
import './styles/globals.css';

createSlideStage().use(litePreset()).mount('#root');
