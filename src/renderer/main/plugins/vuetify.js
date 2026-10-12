import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import {createVuetify} from 'vuetify';

// Dark "fog" theme: near-black surfaces, blood-red primary, bone text.
export default createVuetify({
    theme: {
        defaultTheme: 'fog',
        themes: {
            fog: {
                dark: true,
                colors: {
                    background: '#0c0d11',
                    surface: '#15171d',
                    'surface-bright': '#20232b',
                    'surface-variant': '#2a2e38',
                    'on-surface-variant': '#e6e1d6',
                    primary: '#e0353f',
                    secondary: '#c9a54a',
                    info: '#4a9fd8',
                    success: '#43a66b',
                    warning: '#e0a030',
                    error: '#ef5350',
                    'on-background': '#ece7dc',
                    'on-surface': '#ece7dc',
                },
                variables: {
                    'border-color': '#ffffff',
                    'border-opacity': 0.08,
                },
            },
        },
    },
    defaults: {
        VCard: {rounded: 'lg'},
        VBtn: {rounded: 'lg', style: 'text-transform: none; letter-spacing: normal;'},
        VTextField: {variant: 'solo-filled', density: 'comfortable', flat: true},
        VSelect: {variant: 'solo-filled', density: 'comfortable', flat: true},
        VAutocomplete: {variant: 'solo-filled', density: 'comfortable', flat: true},
        VFileInput: {variant: 'solo-filled', density: 'comfortable', flat: true},
        VSwitch: {color: 'primary', inset: true, hideDetails: 'auto'},
        VSlider: {color: 'primary', thumbLabel: true, hideDetails: true},
        VAlert: {variant: 'tonal', density: 'comfortable'},
        VTooltip: {location: 'bottom'},
    },
});
