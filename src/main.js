/**
 * @file IoC 类
 * @author exodia (d_xinxin@163.com)
 */
void function (define, global, undefined) {
    define(
        function (require) {
            var Container = require('./Container');
            var u = require('./util');
            var Parser = require('./DependencyParser');
            var globalLoader = global.require;
            var ANONY_PREFIX = '^uioc-';

            var creatorWrapper = function (creator, args) {
                return creator.apply(this, args);
            };

            /**
             * IoC 容器类，根据配置实例化一个 IoC 容器
             * @class IoC
             *
             * @param {Object} [config] IoC 配置
             * @param {Function} [config.loader=require] 符合 AMD 规范的模块加载器，默认为全局的 require
             * @param {Object.<string, ComponentConfig>} [config.components]
             * 批量配置构件, 其中每个key 为构件 id，值为构建配置对象，配置选项见 @link IoC#addComponent
             *
             * @returns {IoC}
             */
            function IoC(config) {
                config = config || {};
                if (!(this instanceof IoC)) {
                    return new IoC(config);
                }

                this.moduleLoader = config.loader || globalLoader;
                this.parser = new (config.parser || Parser)(this);
                this.components = {};
                this.container = new Container(this);
                this.addComponent(config.components || {});
            }

            /**
             * 构件配置对象
             *
             * @typedef {Object} ComponentConfig
             * @property {Function | string} creator 创建构件的函数或模块名称
             * @property {boolean} [isFactory=false] 是否为工厂函数，默认false，会通过 new 方式调用，true 时直接调用
             * @property {'transient' | 'singleton' | 'static'} [scope='transient']
             * 构件作用域，默认为 transient，每次获取构件，都会新建一个实例返回，若为 singleton，则会返回同一个实例，若为 static，则直接返回creator
             * @property {DependencyConfig[]} args 传递给构件构造函数的参数，
             * 获取构件时，根据 args 的配置，自动创建其依赖，作为构造函数参数传入
             * @property {Object.<string, DependencyConfig>} [properties] 附加给构件实例的属性，
             * 获取构件时，IoC 会根据 properties 的配置，自动创建其依赖， 作为属性注入构件实例。
             * **note:** 若构件实例存在 ```set + 属性名首字母大些的方法```，则会调用此方法，并将依赖传入，
             * 否则简单的调用 ```this.{propertyName} = {property}```
             */

            /**
             * 构件依赖配置对象，用于配置构件的依赖，若未配置$ref与$import，则本身作为依赖值，否则将根据$ref/$import的声明查找依赖。
             *
             * @typedef {* | Object} DependencyConfig
             * @mixes ComponentConfig
             *
             * @property {string} [$ref] 声明依赖的构件，获取构件时，会自动创建其依赖的构件，作为构造函数参数传入
             * @property {string} [$import] 导入指定构件的配置，将创建一个匿名构件配置，其余的配置将覆盖掉导入的配置
             */

            /**
             *
             * 向容器中注册构件
             *
             * @method IoC#addComponent
             * @param {String | ComponentConfig} id
             * @param {ComponentConfig} [config]
             * @example
             * ioc.addComponent('list', {
             *     // 构造函数创建构件 new creator, 或者字符串，字符串则为 amd 模块名
             *     creator: require('./List'),
             *     scope: 'transient',
             *     args: [{$ref: 'entityName'}],
             *
             *     // 属性注入， 不设置$setter, 则直接instance.xxx = xxx
             *     properties: {
             *          model: {$ref: 'listModel'},
             *          view: {$ref: 'listView'},
             *          name: 'xxxx' // 未设置$ref/$import操作符，'xxxx' 即为依赖值
             *     }
             * });
             *
             * ioc.addComponent('listData', {
             *     creator: 'ListDatal',
             *     scope: 'transient',
             *
             *     properties: {
             *          data: {
             *              $import: 'requestStrategy', // 创建匿名组件，默认继承 requestStrategy 的配置，
             *              args:['list', 'list'] // 重写 requestStrategy 的 args 配置
             *          },
             *     }
             * });
             */
            IoC.prototype.addComponent = function (id, config) {
                var ids = [];
                if (typeof id === 'string') {
                    var conf = {};
                    conf[id] = config;
                    this.addComponent(conf);
                }
                else {
                    for (var k in id) {
                        if (this.components[id]) {
                            u.warn(id + ' has been add! This will be no effect');
                            continue;
                        }
                        this.components[k] = createComponent.call(this, k, id[k]);
                        ids.push(k);
                    }
                }

                for (var i = ids.length - 1; i > -1; --i) {
                    var component = this.getComponentConfig(ids[i]);
                    !component.anonyDeps && transferAnonymousComponents(this, component);
                    component.argDeps = this.parser.getDepsFromArgs(component.args);
                    component.propDeps = this.parser.getDepsFromProperties(component.properties);
                }
            };


            /**
             * 获取构件实例成功后的回调函数
             *
             * @callback getComponentCallback
             * @param {...*} component 获取的构件实例，顺序对应传入的 id 顺序
             */
            /**
             * 获取构件实例
             *
             * @method IoC#getComponent
             * @param {string | string[]} ids 构件 id，数组或者字符串
             * @param {getComponentCallback} cb 获取构件成功后的回调函数，构件将按 id 的顺序依次作为参数传入
             * @returns {IoC}
             */
            IoC.prototype.getComponent = function (ids, cb) {
                ids = ids instanceof Array ? ids : [ids];
                var needModules = {};
                var me = this;
                var parser = me.parser;
                for (var i = 0, len = ids.length; i < len; ++i) {
                    var type = ids[i];
                    var component = this.components[type];
                    if (!component) {
                        u.warn('`%s` has not been added to the Ioc', type);
                    }
                    else {
                        needModules = parser.getDependentModules(component, needModules, component.argDeps);
                    }
                }

                loadComponentModules(this, needModules, u.bind(createInstances, this, ids, cb));

                return this;
            };

            IoC.prototype.getComponentConfig = function (id) {
                return this.components[id];
            };

            /**
             * 设置 IoC 的模块加载器
             *
             * @method IoC#loader
             * @param {Function} loader 符合 AMD 规范的模块加载器
             */
            IoC.prototype.loader = function (loader) {
                this.moduleLoader = loader;
            };

            /**
             * 销毁容器，会遍历容器中的单例，如果有设置dispose，调用他们的 dispose 方法
             *
             * @method IoC#dispose
             */
            IoC.prototype.dispose = function () {
                this.container.dispose();
                this.components = null;
                this.parser = null;
            };

            function createComponent(id, config) {
                var component = {
                    id: id,
                    args: config.args || [],
                    properties: config.properties || {},
                    anonyDeps: null,
                    argDeps: null,
                    propDeps: null,
                    setterDeps: null,
                    scope: config.scope || 'transient',
                    creator: config.creator || null,
                    module: config.module || undefined,
                    isFactory: !!config.isFactory,
                    auto: !!config.auto,
                    instance: null
                };

                // creator为函数，那么先包装下
                typeof component.creator === 'function' && createCreator(component);

                return component;
            }

            function createCreator(component, module) {
                var creator = component.creator = component.creator || module;

                if (typeof creator === 'string') {
                    var method = module[creator];
                    var moduleFactory = function () {
                        return method.apply(module, arguments);
                    };

                    creator = (!component.isFactory || component.scope === 'static') ? method : moduleFactory;
                    component.creator = creator;
                }

                // 给字面量组件和非工厂组件套一层 creator，后面构造实例就可以无需分支判断，直接调用 component.creator
                if (!component.isFactory && component.scope !== 'static') {
                    component.creator = function () {
                        creatorWrapper.prototype = creator.prototype;
                        return new creatorWrapper(creator, arguments);
                    };
                }
            }

            function createAnonymousComponent(context, component, config, idPrefix) {
                var importId = config.$import;
                var refConfig = context.getComponentConfig(importId);
                if (!refConfig) {
                    throw new Error('$import `%s` component, but it is not exist, please check!!', config.$import);
                }

                var id = component.id + '-' + idPrefix + importId;
                config.id = id = (id.indexOf(ANONY_PREFIX) !== -1 ? '' : ANONY_PREFIX) + id;
                delete config.$import;
                context.addComponent(id, u.merge(refConfig, config));

                return id;
            }

            /**
             * 抽取匿名构件
             * @ignored
             * @param {Context} context
             * @param {Object} component
             */
            function transferAnonymousComponents(context, component) {
                component.anonyDeps = [];
                var args = component.args;
                var id = null;
                for (var i = args.length - 1; i > -1; --i) {
                    if (u.hasImport(args[i])) {
                        // 给匿名组件配置生成一个 ioc 构件id
                        id = createAnonymousComponent(context, component, args[i], '$arg.');
                        args[i] = { $ref: id };
                        component.anonyDeps.push(id);
                    }
                }

                var props = component.properties;
                for (var k in props) {
                    if (u.hasImport(props[k])) {
                        id = createAnonymousComponent(context, component, props[k], '$prop.');
                        props[k] = { $ref: id };
                        component.anonyDeps.push(id);
                    }
                }
            }

            function loadComponentModules(context, moduleMaps, cb) {
                var modules = [];
                for (var k in moduleMaps) {
                    modules.push(k);
                }

                context.moduleLoader(modules, function () {
                    for (var i = arguments.length - 1; i > -1; --i) {
                        var module = arguments[i];
                        var components = moduleMaps[modules[i]];
                        for (var j = components.length - 1; j > -1; --j) {
                            var component = components[j];
                            typeof component.creator !== 'function' && createCreator(component, module);
                        }
                    }
                    cb();
                });
            }

            function createInstances(ids, cb) {
                var instances = Array(ids.length);
                if (ids.length === 0) {
                    return cb.apply(null, instances);
                }

                var container = this.container;
                var parser = this.parser;
                var context = this;
                var needModules = {};
                var count = ids.length;
                var done = function () {
                    --count === 0 && cb.apply(null, instances);
                };


                var task = function (index, component) {
                    return function (instance) {
                        instances[index] = instance;
                        if (component) {
                            needModules = parser.getDependentModules(component, {}, component.propDeps);

                            // 获取 setter 依赖
                            if (!component.setterDeps && component.auto) {
                                component.setterDeps = parser.getDepsFromSetters(instance, component.properties);
                                needModules = parser.getDependentModules(component, needModules, component.setterDeps);
                            }

                            loadComponentModules(
                                context, needModules, u.bind(injectDeps, context, instance, component, done)
                            );
                        }
                        else {
                            done();
                        }
                    };
                };

                for (var i = ids.length - 1; i > -1; --i) {
                    var component = this.components[ids[i]];
                    container.createInstance(component, task(i, component));
                }
            }

            function injectDeps(instance, component, cb) {
                var complete = {
                    prop: false,
                    setter: false
                };
                var injected = function (type) {
                    complete[type] = true;
                    complete.prop && complete.setter && cb();
                };
                injectPropDependencies(this, instance, component, u.bind(injected, null, 'prop'));
                injectSetterDependencies(this, instance, component, u.bind(injected, null, 'setter'));
            }

            function injectSetterDependencies(context, instance, component, cb) {
                var deps = component.setterDeps || [];
                context.getComponent(deps, function () {
                    for (var i = deps.length - 1; i > -1; --i) {
                        var dep = deps[i];
                        setProperty(instance, dep, arguments[i]);
                    }
                    cb();
                });
            }

            function injectPropDependencies(context, instance, component, cb) {
                var deps = component.propDeps;
                var props = component.properties;
                context.getComponent(deps, function () {
                    for (var k in props) {
                        var value = props[k];
                        if (u.hasReference(value)) {
                            value = arguments[u.indexOf(deps, value.$ref)];
                        }
                        setProperty(instance, k, value);
                    }
                    cb();
                });
            }

            function setProperty(instance, key, value) {
                var name = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
                typeof instance[name] === 'function' ? instance[name](value) : (instance[key] = value);
            }

            return IoC;
        }
    );

}(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory; }, this);