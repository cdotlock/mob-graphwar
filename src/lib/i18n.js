export const copy = {
  en: {
    play: "Play",
    leaderboard: "Leaderboard",
    apiDocs: "API Docs",
    signIn: "Sign in",
    signOut: "Sign out",
    account: "Account",
    language: "中文",
    login: "Login",
    register: "Register",
    handle: "Handle",
    displayName: "Display name",
    password: "Password",
    close: "Close",
    submit: "Continue"
  },
  zh: {
    play: "开始游戏",
    leaderboard: "排行榜",
    apiDocs: "API 文档",
    signIn: "登录",
    signOut: "退出",
    account: "账号",
    language: "EN",
    login: "登录",
    register: "注册",
    handle: "账号名",
    displayName: "显示名",
    password: "密码",
    close: "关闭",
    submit: "继续"
  }
};

export function t(locale, key) {
  return copy[locale]?.[key] || copy.en[key] || key;
}
