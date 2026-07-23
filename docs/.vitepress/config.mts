import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: '@guebbit/react-toolkit',
  description: 'React 3 composables and Pinia stores for CRUD screens: caching, optimistic updates, rollback, and form validation.',
  base: '/react-toolkit/',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/composables/structure-rest-api' }
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Testing', link: '/guide/testing' }
        ]
      },
      {
        text: 'Composables',
        items: [
          { text: 'useStructureRestApi', link: '/composables/structure-rest-api' },
          { text: 'useStructureDataManagement', link: '/composables/structure-data-management' },
          { text: 'useStructureFormValidation', link: '/composables/structure-form-validation' }
        ]
      },
      {
        text: 'Stores',
        items: [
          { text: 'useNotificationsStore', link: '/stores/notifications' },
          { text: 'useCoreStore', link: '/stores/core' }
        ]
      }
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/Guebbit/react-toolkit' }]
  }
})
