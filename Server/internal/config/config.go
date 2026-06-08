package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	AppEnv            string `yaml:"app_env"`
	HTTPAddr          string `yaml:"http_addr"`
	JWTSecret         string `yaml:"jwt_secret"`
	CredentialSecret  string `yaml:"credential_secret"`
	AllowInsecureTLS  bool   `yaml:"allow_insecure_tls"`
	ChaoxingAESKey    string `yaml:"chaoxing_aes_key"`
	ChaoxingUserAgent string `yaml:"chaoxing_user_agent"`
	ActivityListLimit int    `yaml:"activity_list_limit"`
	PostgresDSN       string `yaml:"postgres_dsn"`
	RedisAddr         string `yaml:"redis_addr"`
	RedisPassword     string `yaml:"redis_password"`
	RedisDB           int    `yaml:"redis_db"`
	BaiduMapAK        string `yaml:"baidu_map_ak"`
}

// defaultConfigPath 是默认的配置文件路径（相对或绝对路径）。
const defaultConfigPath = "config.yaml"

// configPathEnv 环境变量名，用于覆盖配置文件路径。
const configPathEnv = "CONFIG_PATH"

// Load 从 YAML 配置文件加载配置。
// 配置文件路径优先级：CONFIG_PATH 环境变量 > 默认值 "config.yaml"。
// 如果通过 CONFIG_PATH 指定了路径但文件不存在，不会回退到默认路径，而是直接报错，
// 以便用户及时意识到配置路径配置有误。
func Load() Config {
	cfg := Config{}

	configPath := resolveConfigPath()

	// 检查路径是否存在且为文件，给出明确的诊断信息
	fi, err := os.Stat(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			panic(fmt.Errorf("config file not found: %s (current working directory: %s; set %s env var to specify a custom path)",
				configPath, mustGetwd(), configPathEnv))
		}
		panic(fmt.Errorf("access config file %s failed: %w", configPath, err))
	}
	if fi.IsDir() {
		panic(fmt.Errorf("config path %s is a directory, expected a file\n"+
			"\tPossible cause on Windows: Docker bind mount from a network drive (Z:\\, \\\\NAS\\) may have failed\n"+
			"\tand created an empty directory instead. Try: mount a local path, copy config into the image,\n"+
			"\tor set CONFIG_PATH env var to point to a different location",
			configPath))
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		panic(fmt.Errorf("read config file %s failed: %w", configPath, err))
	}
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		panic(fmt.Errorf("parse config file %s failed: %w", configPath, err))
	}

	if cfg.ActivityListLimit <= 0 {
		cfg.ActivityListLimit = 5
	}
	if cfg.RedisAddr == "" {
		cfg.RedisAddr = "127.0.0.1:6379"
	}
	return cfg
}

// resolveConfigPath 返回实际使用的配置文件路径。
func resolveConfigPath() string {
	if p := os.Getenv(configPathEnv); p != "" {
		return p
	}
	return defaultConfigPath
}

// mustGetwd 获取当前工作目录，失败时返回 "<unknown>"。
func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "<unknown>"
	}
	return wd
}

// ConfigPathEnv 返回环境变量名，供外部（如 Dockerfile）引用。
func ConfigPathEnv() string {
	return configPathEnv
}

// DefaultConfigPath 返回默认配置文件路径。
func DefaultConfigPath() string {
	abs, err := filepath.Abs(defaultConfigPath)
	if err != nil {
		return defaultConfigPath
	}
	return abs
}

func (c Config) MaskedDSN() string {
	return fmt.Sprintf("%s ...", c.PostgresDSN[:min(len(c.PostgresDSN), 24)])
}
