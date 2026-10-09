import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: '@guebbit/react-toolkit',
  description: 'React hooks and Zustand stores for CRUD screens: caching, optimistic updates, rollback, and form validation.',
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
        text: 'Hooks',
        items: [
          { text: 'useStructureCrudApi', link: '/composables/structure-crud-api' },
          { text: 'useStructureRestApi', link: '/composables/structure-rest-api' },
          { text: 'useStructureSearchApi', link: '/composables/structure-search-api' },
          { text: 'useStructureDataManagement', link: '/composables/structure-data-management' },
          { text: 'useStructureFormValidation', link: '/composables/structure-form-validation' },
          { text: 'useUploadProgress', link: '/composables/upload-progress' }
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
