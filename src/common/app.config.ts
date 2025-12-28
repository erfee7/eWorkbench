/**
 * Application Identity (Brand)
 *
 * Also note that the 'Brand' is used in the following places:
 *  - README.md               all over
 *  - package.json            app-slug and version
 *  - [public/manifest.json]  name, short_name, description, theme_color, background_color
 */
export const Brand = {
  Title: {
    Base: 'eWorkbench',
    Common: (process.env.NODE_ENV === 'development' ? '[DEV] ' : '') + 'eWorkbench',
  },
  Meta: {
    Description: 'Launch eWorkbench to unlock the full potential of AI, with precise control over your data and models. Voice interface, AI personas, advanced features, and fun UX.',
    SiteName: 'eWorkbench | Precision AI for You',
    ThemeColor: '#32383E',
    TwitterSite: '',
  },
  URIs: {
    Home: '',
    // App: '',
    CardImage: '',
    OpenRepo: 'https://github.com/erfee7/eWorkbench',
    SupportInvite: '',
    // Twitter: '',
    PrivacyPolicy: 'https://big-agi.com/privacy',
    TermsOfService: 'https://big-agi.com/terms',

    // Upstream links
    UpstreamRepo: 'https://github.com/enricoros/big-agi',
    UpstreamHome: 'https://big-agi.com',
    UpstreamOpenProject: 'https://github.com/users/enricoros/projects/4',
  },
  Docs: {
    Public: (docPage: string) => `https://big-agi.com/docs/${docPage}`,
  }
} as const;