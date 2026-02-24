
// 解析自訂規則 expression 轉回 conditions 陣列
export function parseRuleExpression(expression: string, action: string): { action: string, conditions: any[] } {
    try {
        const conditions: any[] = [];
        
        // 移除最外層空格
        expression = expression.trim();
        
        // 用 " or (" 分割成多個群組 (每個群組都是用括號包起來的)
        // 格式: (condition1 and http.host eq "domain") or (condition2 and http.host eq "domain")
        const groups = expression.split(/\)\s+or\s+\(/);
        
        groups.forEach((group, groupIndex) => {
            // 移除開頭和結尾的括號
            group = group.replace(/^\(/, '').replace(/\)$/, '');
            // 移除 http.host eq "domain" 部分
            group = group.replace(/\s+and\s+http\.host\s+eq\s+"[^"]+"\s*$/, '');
            // 解析群組內的條件 (用 " and " 分割)
            const conditionParts = group.split(/\s+and\s+/);
            conditionParts.forEach((part, partIndex) => {
                const condition = parseSingleCondition(part.trim());
                if (condition) {
                    // 第一個群組的第一個條件沒有 logicalOperator
                    // 第一個群組的後續條件是 'and'
                    // 其他群組的第一個條件是 'or'，後續條件是 'and'
                    if (groupIndex === 0 && partIndex === 0) {
                        condition.logicalOperator = null;
                    } else if (groupIndex > 0 && partIndex === 0) {
                        condition.logicalOperator = 'or';
                    } else {
                        condition.logicalOperator = 'and';
                    }
                    conditions.push(condition);
                }
            });
        });
        
        return { action, conditions };
    } catch (error) {
        console.error('Error parsing custom rule expression:', error);
        return { action, conditions: [] };
    }
}

// 解析自訂規則 expression 轉回 conditions 陣列
export function parseCdnRuleExpression(expression: string) {
    try {
        const conditions: any[] = [];
        
        // 移除最外層空格
        expression = expression.trim();
        
        // 用 " or (" 分割成多個群組 (每個群組都是用括號包起來的)
        // 格式: (condition1 and http.host eq "domain") or (condition2 and http.host eq "domain")
        const groups = expression.split(/\)\s+or\s+\(/);
        
        groups.forEach((group, groupIndex) => {
            // 移除開頭和結尾的括號
            group = group.replace(/^\(/, '').replace(/\)$/, '');
            // 移除 http.host eq "domain" 部分
            group = group.replace(/\s+and\s+http\.host\s+eq\s+"[^"]+"\s*$/, '');
            // 解析群組內的條件 (用 " and " 分割)
            const conditionParts = group.split(/\s+and\s+/);
            conditionParts.forEach((part, partIndex) => {
                const condition = parseSingleCondition(part.trim());
                if (condition) {
                    // 第一個群組的第一個條件沒有 logicalOperator
                    // 第一個群組的後續條件是 'and'
                    // 其他群組的第一個條件是 'or'，後續條件是 'and'
                    if (groupIndex === 0 && partIndex === 0) {
                        condition.logicalOperator = null;
                    } else if (groupIndex > 0 && partIndex === 0) {
                        condition.logicalOperator = 'or';
                    } else {
                        condition.logicalOperator = 'and';
                    }
                    conditions.push(condition);
                }
            });
        });
        
        return conditions
    } catch (error) {
        console.error('Error parsing custom rule expression:', error);
        return [];
    }
}

// 解析單一條件
export function parseSingleCondition(conditionStr: string): any | null {
    try {
        // Header 條件: any(http.request.headers["name"][*] eq "value")
        // Header not_contains: not any(http.request.headers["name"][*] contains "value")
        const headerNotContainsMatch = conditionStr.match(/not\s+any\(http\.request\.headers\["([^"]+)"\]\[\*\]\s+contains\s+"([^"]+)"\)/);
        if (headerNotContainsMatch) {
            return {
                field: 'header',
                name: headerNotContainsMatch[1],
                operator: 'not_contains',
                value: headerNotContainsMatch[2]
            };
        }
        
        const headerAnyMatch = conditionStr.match(/any\(http\.request\.headers\["([^"]+)"\]\[\*\]\s+(eq|contains)\s+"([^"]+)"\)/);
        if (headerAnyMatch) {
            return {
                field: 'header',
                name: headerAnyMatch[1],
                operator: headerAnyMatch[2],
                value: headerAnyMatch[3]
            };
        }
        
        const headerAllMatch = conditionStr.match(/all\(http\.request\.headers\["([^"]+)"\]\[\*\]\s+ne\s+"([^"]+)"\)/);
        if (headerAllMatch) {
            return {
                field: 'header',
                name: headerAllMatch[1],
                operator: 'ne',
                value: headerAllMatch[2]
            };
        }
        
        // Cloudflare 欄位名稱轉回簡化名稱 (request.full_uri)
        const mapField = (cfField: string): string => {
            if (cfField === 'request.full_uri') return 'full_uri';
            return cfField;
        };
        
        // file_extension not_in 條件: not http.request.uri.path.extension in {"mp3" "mp4"}
        const fileExtNotInMatch = conditionStr.match(/not\s+http\.request\.uri\.path\.extension\s+in\s+\{([^}]+)\}/);
        if (fileExtNotInMatch) {
            // 解析 {"mp3" "mp4"} 格式的值
            const values = fileExtNotInMatch[1].match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, '')).join(',') || '';
            return {
                field: 'file_extension',
                operator: 'not_in',
                value: values
            };
        }
        
        // file_extension in 條件: http.request.uri.path.extension in {"mp3" "mp4"}
        const fileExtInMatch = conditionStr.match(/http\.request\.uri\.path\.extension\s+in\s+\{([^}]+)\}/);
        if (fileExtInMatch) {
            // 解析 {"mp3" "mp4"} 格式的值
            const values = fileExtInMatch[1].match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, '')).join(',') || '';
            return {
                field: 'file_extension',
                operator: 'in',
                value: values
            };
        }
        
        // file_extension eq/ne 條件: http.request.uri.path.extension eq "mp3"
        const fileExtMatch = conditionStr.match(/http\.request\.uri\.path\.extension\s+(eq|ne)\s+"([^"]+)"/);
        if (fileExtMatch) {
            return {
                field: 'file_extension',
                operator: fileExtMatch[1],
                value: fileExtMatch[2]
            };
        }
        
        // not_contains 條件: not http.request.full_uri contains "value"
        const notContainsMatch = conditionStr.match(/not\s+http\.([a-z._]+)\s+contains\s+"([^"]+)"/);
        if (notContainsMatch) {
            return {
                field: mapField(notContainsMatch[1]),
                operator: 'not_contains',
                value: notContainsMatch[2]
            };
        }
        
        // wildcard 條件: http.request.full_uri wildcard r"value"
        const wildcardMatch = conditionStr.match(/http\.([a-z._]+)\s+wildcard\s+r"([^"]+)"/);
        if (wildcardMatch) {
            return {
                field: mapField(wildcardMatch[1]),
                operator: 'wildcard',
                value: wildcardMatch[2]
            };
        }
        
        // 一般條件: http.request.full_uri eq "value" 或 http.request.full_uri contains "value"
        const generalMatch = conditionStr.match(/http\.([a-z._]+)\s+(eq|ne|contains)\s+"([^"]+)"/);
        if (generalMatch) {
            return {
                field: mapField(generalMatch[1]),
                operator: generalMatch[2],
                value: generalMatch[3]
            };
        }
        
        // starts_with 條件: starts_with(http.request.full_uri, "value")
        const startsWithMatch = conditionStr.match(/starts_with\(http\.([a-z._]+),\s*"([^"]+)"\)/);
        if (startsWithMatch) {
            return {
                field: mapField(startsWithMatch[1]),
                operator: 'starts_with',
                value: startsWithMatch[2]
            };
        }
        
        // ends_with 條件: ends_with(http.request.full_uri, "value")
        const endsWithMatch = conditionStr.match(/ends_with\(http\.([a-z._]+),\s*"([^"]+)"\)/);
        if (endsWithMatch) {
            return {
                field: mapField(endsWithMatch[1]),
                operator: 'ends_with',
                value: endsWithMatch[2]
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing single condition:', error);
        return null;
    }
}
